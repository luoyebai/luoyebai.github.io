---
title: DDS 选型与调参：从 QoS 到零拷贝
slug: dds-qos-tuning
date: 2026-04-12
tags: [DDS, 中间件, 系统工程]
summary: 机器人上跑 DDS，第一件要决定的是「用什么传输」和「用什么 QoS」。选错了要么延迟抖动，要么丢包重传把带宽吃光。这篇记录我在四足和人形项目上把 DDS 从 2.5ms 抖到 150µs 的过程。
cover: assets/bg/neon.jpg
featured: true
draft: false
archived: false
---

机器人上第一次接 DDS，最容易犯的错是把它当"更高级的 ROS 话题"用——默认配置跑起来能通，就以为没事了。等到控制周期压到 1 kHz，才发现延迟抖动比控制器的计算时间还大。

DDS 是**以数据为中心的发布订阅**（DCPS），它的所有行为都由 QoS 策略描述。理解 QoS 就理解了 DDS。

## 先搞清传输路径

一条消息从发布者到订阅者，实际经过：

```
用户线程 → 序列化 → 发送队列 → 传输层(socket/shared-mem) → 接收队列 → 反序列化 → 回调线程
```

每一段都有 QoS 在管：

| 环节 | 相关 QoS | 典型踩坑 |
|---|---|---|
| 序列化 | — | 大消息（点云/图像）拷贝开销占比极高 |
| 发送队列 | `RELIABILITY` `HISTORY` `DURABILITY` | 默认 `RELIABLE` 导致重传风暴 |
| 传输层 | `TRANSPORT_PRIORITY` | 全部走 UDP 回环，没走共享内存 |
| 接收队列 | `RESOURCE_LIMITS` | 队列太浅，突发时丢样本 |
| 回调 | `DEADLINE` `LIVELINESS` | 没有 deadline 就永远发现不了丢帧 |

## Reliability：控制回路要用 BEST_EFFORT

默认的 `RELIABLE` 会为重传维护心跳与 ACK/NACK 状态。在控制回路上这是**反效果**：你要的是最新的一帧，不是补发三帧前的旧数据。

::: warn 一个真实的翻车现场
四足站立时关节指令用 `RELIABLE`，网络偶发抖动触发重传，接收端按序交付导致**旧指令后到**，关节出现一次 3ms 的力矩毛刺，机器人原地晃了一下。改成 `BEST_EFFORT` + `KEEP_LAST(1)` 后再没出现。
:::

```xml
<qos>
  <reliability><kind>BEST_EFFORT</kind></reliability>
  <history><kind>KEEP_LAST</kind><depth>1</depth></history>
  <durability><kind>VOLATILE</kind></durability>
</qos>
```

反过来说，**参数下发、模式切换这类"必须到达"的消息一定要 RELIABLE + TRANSIENT_LOCAL**，否则新上线的订阅者拿不到当前配置，会出现"同样的代码，重启后行为不同"。

## 零拷贝：省掉最大的一块开销

如果发布者和订阅者在同一进程内，启用进程内通信可以完全跳过序列化：

```cpp
rclcpp::NodeOptions options;
options.use_intra_process_comms(true);
auto node = std::make_shared<rclcpp::Node>("controller", options);

// 用移动语义发布，避免拷贝
auto msg = std::make_unique<sensor_msgs::msg::Imu>();
fill_from_driver(*msg);
imu_pub->publish(std::move(msg));
```

跨进程时，CycloneDDS / Iceoryx 提供共享内存传输（`iox-roudi`）。对 100 KB 以上的消息，收益非常明显。

## 实测数据

四足项目，IMU + 关节反馈 + 足端力，控制周期 1 kHz：

| 配置 | 延迟均值 | 延迟 p99 | 最坏 |
|---|---:|---:|---:|
| 默认（RELIABLE / UDP 回环） | 425 µs | 2.5 ms | 12 ms |
| + BEST_EFFORT + KEEP_LAST(1) | 210 µs | 780 µs | 3.1 ms |
| + 进程内零拷贝 | 92 µs | 148 µs | 410 µs |
| + 共享内存 + CPU 隔离 | 61 µs | 96 µs | 180 µs |

关键结论：**控制器本身只占 90 µs**，剩下的全是中间件和调度。优化 DDS 比优化算法收益大一个数量级。

## 发现机制：大网络里一定要收敛

DDS 的自动发现（SPDP/SEDP）在节点数多了之后会产生大量组播。两台机器几十个节点时，启动阶段能刷出几百 MB 的发现流量。

```xml
<!-- CycloneDDS：单播发现 + 静态对端，关掉组播 -->
<Discovery>
  <ParticipantIndex>auto</ParticipantIndex>
  <MaxAutoParticipantIndex>32</MaxAutoParticipantIndex>
  <Peers>
    <Peer Address="192.168.1.10"/>
    <Peer Address="192.168.1.11"/>
  </Peers>
  <EnableTopicDiscoveryEndpoints>false</EnableTopicDiscoveryEndpoints>
</Discovery>
```

代价是**新增节点要手工登记**。在固定拓扑的机器人上完全可接受，换来的是启动时间和网络稳定性。

## 我的默认 QoS 组合

::: note 直接抄
- **传感器数据流**（IMU/关节/力）：`BEST_EFFORT` + `KEEP_LAST(1)` + `VOLATILE`
- **控制指令**：`BEST_EFFORT` + `KEEP_LAST(1)` + `DEADLINE(2ms)`
- **参数/配置**：`RELIABLE` + `KEEP_LAST(1)` + `TRANSIENT_LOCAL`
- **状态上报/日志**：`RELIABLE` + `KEEP_LAST(10)` + `TRANSIENT_LOCAL`
- **点云/图像**：`BEST_EFFORT` + `KEEP_LAST(1)` + 共享内存传输

关键是为每条流**显式声明**，不要依赖默认值。默认值是为通用场景设计的，不是为你的控制回路。
:::

## 排查工具

```bash
# 看实际生效的 QoS 与匹配情况
ros2 topic info /joint_states --verbose

# CycloneDDS 内部统计：丢包、重传、队列溢出
ddsperf -c -Q  # 或用 CYCLONEDDS_URI 打开 tracing

# 延迟直方图（自己写一个小节点，按时间戳统计）
ros2 run my_tools latency_probe --duration 30
```

::: tip 一条经验
先把延迟的 **p99** 打出来再加功能。均值好看但 p99 是 5ms 的系统，跑什么控制器都会抖。
:::
