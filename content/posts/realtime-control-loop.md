---
title: 运控回路的实时性：1 kHz 到底能不能跑满
slug: realtime-control-loop
date: 2025-12-18
tags: [实时系统, ROS2, 运控]
summary: 区分周期、执行时间、数据年龄与截止时间，建立有界的测量路径，再评估线程调度、内存与系统配置对控制回路的影响。
cover: assets/bg/void.jpg
updated: 2026-09-24
---

“控制器运行在 1 kHz”说明目标周期是 1 ms，却没有说明输入多旧、计算何时结束、驱动何时执行。讨论实时性时，需要把这些时间分开。

## 四个时间概念

| 指标 | 定义 | 作用 |
|---|---|---|
| 唤醒抖动 | 实际开始减去计划开始 | 定位调度与定时问题 |
| 执行时间 | 本次计算结束减去开始 | 评估计算预算 |
| 数据年龄 | 使用时刻减去采样时刻 | 判断反馈是否新鲜 |
| 截止时间违约 | 结束时刻晚于本周期 deadline | 判断按时完成的比例 |

同一时钟域内使用单调时钟测间隔。跨设备测数据年龄要说明同步精度；ROS 时间发生暂停或跳变时，也不能直接拿它替代所有实时计时。

## 测量不要成为新的抖动来源

在控制循环里写文件、打印日志或让 `std::vector` 不断扩容，会改变正在测量的系统。初始化时分配固定容量，运行时只写入，结束后再导出，是最简单的起点。

下面是 **C++17 独立示例**。它演示有界记录，不运行控制器，也不证明操作系统已经满足实时要求。

```cpp
#include <array>
#include <cstddef>
#include <cstdint>
#include <iostream>

struct Timing { std::uint64_t start_ns, finish_ns, deadline_ns; };

template<std::size_t N>
struct TraceBuffer {
    std::array<Timing, N> rows{};
    std::size_t used = 0, dropped = 0;
    void record(Timing row) noexcept {
        if (used < N) rows[used++] = row;
        else ++dropped;
    }
};

int main() {
    TraceBuffer<2> trace;
    trace.record({0, 800, 1000});
    trace.record({1000, 2100, 2000});
    trace.record({2000, 2700, 3000});
    // 仅在采样结束后读取；并发读写需要另外设计同步协议。
    std::size_t missed = 0;
    for (std::size_t i = 0; i < trace.used; ++i)
        missed += trace.rows[i].finish_ns > trace.rows[i].deadline_ns;
    std::cout << "missed=" << missed << ", dropped=" << trace.dropped << '\n';
}
```

预期输出是 `missed=1, dropped=1`。长时间运行可使用有界环形缓冲或单生产者队列，但必须明确满缓冲策略和线程间的内存同步。

## 从应用热路径开始

检查动态内存分配、缺页、无界等待和同步 I/O。固定尺寸对象与预分配有帮助，但不能只凭用了 `std::array` 就宣布“零抖动”：库调用、消息传递、锁和驱动仍需要测量。ROS 的实时编程资料也强调避免缺页、动态分配及无界阻塞，见 [实时编程说明](https://docs.ros.org/en/dashing/Tutorials/Real-Time-Programming.html)；其中安装示例属于旧发行版，不应直接作为当前部署步骤。

一个快回调如果排在慢回调后面，仍可能晚执行。ROS 2 中可以隔离 callback group 与 executor，但还应检查组是否被自动加入其他执行器，以及线程的启动、退出和 join 生命周期。不要用一个无管理的 detached 线程掩盖退出问题。

## 调度策略是系统配置，不是魔法开关

`SCHED_FIFO` 线程持续占用 CPU 时会影响较低优先级任务。设置策略后应检查返回值，并核对权限、实时带宽限制、依赖线程和中断线程的优先级。不存在适合所有设备的“统一优先级 80”。Linux 的 [实时调度文档](https://docs.kernel.org/scheduler/sched-rt-group.html)说明了相关预算机制。

绑核也要看任务之间的数据与中断路径。把全部中断搬走，可能增加跨核通信；把所有相关工作塞到一个核，又可能造成竞争。先明确拓扑，再对照测量。

不要把 `chrt ./controller` 和 `taskset ./controller` 分别执行当成同一进程的两个设置步骤，那会启动两份程序。正式启动配置应在服务或一个明确的启动命令中组合，并在运行后读取实际调度与亲和性确认。

## 系统级测试如何分层

1. 测定时唤醒延迟，记录系统空闲与压力负载两种条件。
2. 加入计算和内存访问，定位是否由应用热路径造成长尾。
3. 加入中间件与驱动，测端到端数据年龄及截止时间违约。
4. 覆盖长时间运行、热状态、网络拥塞和故障恢复。

`cyclictest` 等工具能提供调度延迟的线索，但不能替代完整控制回路测试。CPU 调速、PREEMPT_RT、内存锁定与隔离设置都应逐项评估，并保留版本与配置。

## 怎样呈现结果才有意义

报告样本量、时长、负载、p50/p95/p99、观测最大值与 deadline miss 次数。**各环节的 p99 不能简单相加当作整环 p99**；整环分布应从同一次循环的时间戳计算。

有限测试中的最大值是“已观察最大值”，不是最坏执行时间证明。一次 30 秒测试没有超时，也不能保证未来不会发生。

## 周期由闭环需求和测量共同决定

降低频率可能改善计算余量，但也会改变采样与控制带宽。是否从 1 kHz 改成 500 Hz，需要控制稳定性、驱动行为与任务表现的验证，不能仅凭较低的 p99 决定。

最终应留下三份可重复使用的产物：时间戳定义、固定条件的测试脚本，以及带版本号的结果记录。这样下一次换内核、驱动或中间件时，才能判断变化来自哪里。

继续阅读：[DDS 调参与测量](/posts/dds-qos-tuning/) · [四足 MPC 与 WBC 的接口](/posts/quadruped-mpc-kinematics/)。
