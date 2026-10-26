---
title: 运控回路的实时性：1 kHz 到底能不能跑满
slug: realtime-control-loop
date: 2025-12-18
tags: [实时系统, ROS2, 运控]
summary: 关节控制周期标称 1 kHz，不代表每周期都能按时完成。这篇把从传感器采样到电机下发的整条链路拆开量一遍，给出抖动来源和真正有效的优化手段，以及在 PREEMPT_RT 上踩的坑。
cover: assets/bg/void.jpg
---

"我们控制器跑 1 kHz"——这句话通常只说明**定时器**是 1 kHz。

一条完整的运控回路：编码器/IMU 采样 → 驱动 → 内核 → 中间件 → 控制计算 → 力矩下发 → 电机。任何一环抖动，都会吃掉相位裕度，表现为关节"嗡嗡"响或者高频颤振。

## 先把抖动量出来

**别只看均值。** 实时系统里 p99 和最坏值才是你真正面对的。每个环节打时间戳，跑 30 秒统计分布：

```cpp
struct Timing {
    uint64_t t_recv, t_calc_begin, t_calc_end, t_send;
    void dump(std::vector<Timing>& log);
};

void control_callback(const JointState::SharedPtr msg) {
    Timing t;
    t.t_recv = now_ns();
    t.t_calc_begin = now_ns();
    compute_torque(msg, tau_out_);
    t.t_calc_end = now_ns();
    publish_torque(tau_out_);
    t.t_send = now_ns();
    timing_log.push_back(t);
}
```

四足项目实测（默认 ROS 2 配置，控制周期 1 ms）：

| 环节 | 均值 | p99 | 最坏 |
|---|---:|---:|---:|
| 传感器采样 + 驱动 | 40 µs | 120 µs | 480 µs |
| 中间件传输（默认） | 180 µs | 1.9 ms | 12 ms |
| 控制计算（WBC） | 90 µs | 110 µs | 140 µs |
| 力矩下发 | 55 µs | 160 µs | 600 µs |
| **整环** | **365 µs** | **2.3 ms** | **13 ms** |

::: danger 结论很直接
控制算法只占 90 µs，p99 整环延迟是 2.3 ms——**已经超过 1 ms 周期两倍多**。你的瓶颈从来不是算法。
:::

## 抖动的四个来源

### 1. 内存分配与锁（最常见的隐性抖动）

热路径里的 `new`、`std::vector` 扩容、`std::shared_ptr` 的原子引用计数、`std::function` 的堆分配，单个都是微秒级，但会触发分配器加锁和缺页中断。

```cpp
// 反例：回调里构造大对象
void on_state(const JointState::SharedPtr& msg) {
    Eigen::MatrixXd H(23, 23);          // 堆分配
    std::vector<double> buf(msg->size); // 又一次
    ...
}

// 正例：构造时预分配，热路径零分配
class Controller {
    Eigen::Matrix<double, 23, 23> H_;   // 成员变量，栈/对象内
    std::array<double, 256> buf_;
public:
    void on_state(const JointState& msg) { /* 只用 H_ / buf_ */ }
};
```

### 2. 调度与优先级反转

默认的 `SingleThreadedExecutor` 会被任何慢回调阻塞。控制回调必须隔离：

```cpp
auto ctrl_group = node->create_callback_group(
    rclcpp::CallbackGroupType::MutuallyExclusive);
auto ctrl_exec = std::make_shared<rclcpp::executors::SingleThreadedExecutor>();
ctrl_exec->add_callback_group(ctrl_group, node->get_node_base_interface());
std::thread([ctrl_exec] { ctrl_exec->spin(); }).detach();
```

再给这个线程设实时优先级：

```cpp
sched_param param{ .sched_priority = 80 };
pthread_setschedparam(pthread_self(), SCHED_FIFO, &param);
```

### 3. 中间件

详见 [DDS 选型与调参](/posts/dds-qos-tuning/)：`BEST_EFFORT` + `KEEP_LAST(1)` + 进程内零拷贝，能把中间件从 180 µs/p99 1.9 ms 压到 20 µs/p99 40 µs。

### 4. 内核与 CPU

- **CPU 频率调节**：`performance` 调速器，否则 CPU 降频会让计算时间翻倍
- **CPU 隔离**：`isolcpus=2,3`，控制线程独占核
- **中断亲和性**：把网卡/总线中断赶到其它核，别打断控制线程
- **内存大页**：减少 TLB miss

```bash
# 内核启动参数
isolcpus=2,3 nohz_full=2,3 rcu_nocbs=2,3

# 运行时
cpupower frequency-set -g performance
chrt -f 80 ./joint_controller
taskset -c 2 ./joint_controller
```

## 优化后的结果

| 配置 | 延迟均值 | p99 | 最坏 |
|---|---:|---:|---:|
| 默认 | 365 µs | 2.3 ms | 13 ms |
| + QoS + 零拷贝 | 132 µs | 320 µs | 1.6 ms |
| + 回调隔离 + 预分配 | 96 µs | 168 µs | 620 µs |
| + PREEMPT_RT + 隔离核 | 71 µs | 104 µs | 210 µs |

## PREEMPT_RT 的坑

装实时内核不是终点，反而会引入新问题：

::: warn 四个实际踩到的
1. **`SCHED_FIFO` 优先级给太高（99）**，控制线程把内核线程饿死，系统整体卡顿。80~85 之间比较合适。
2. **实时内核下 `malloc` 更慢**。实时补丁为了可预测性牺牲了吞吐，热路径零分配变得更加重要。
3. **CPU 隔离后没设 `rcu_nocbs`**，RCU 回调仍在隔离核上跑，抖动没降下来。两个参数必须配套。
4. **`nohz_full` 与某些驱动不兼容**，导致定时器精度反而变差。要逐个驱动验证。
:::

## 一个反直觉的结论

把控制周期从 1 kHz 降到 500 Hz，控制器性能**没有变差**——因为 p99 延迟从 2.3 ms 降到 1.1 ms，有效控制带宽反而提高了。

::: tip 工程建议
**先测抖动，再定周期。** 与其追求一个跑不满的高频率，不如保证每个周期都按时完成。一个稳定抖动的 500 Hz 回路，胜过抖到 2.3 ms 的 1 kHz。
:::

## 检查清单

- [x] 每个环节打时间戳，统计 p99 与最坏值
- [x] QoS 改 `BEST_EFFORT` / `KEEP_LAST(1)`
- [x] 进程内零拷贝（同进程节点）
- [x] 控制回调独立 callback group + 实时优先级
- [x] 热路径零分配、零锁、无 `std::function`
- [x] CPU 调速器 `performance`
- [x] PREEMPT_RT + `isolcpus` + `nohz_full` + `rcu_nocbs`
- [ ] 用 `cyclictest` 做 24 小时最坏延迟验证（下一步）
- [ ] 长时压力测试下检查内存碎片对分配时间的影响
