---
title: dds-middleware-kit
slug: dds-middleware-kit
tagline: DDS 传输层封装 + 延迟/吞吐压测工具
date: 2026-04-02
tags: [DDS, 中间件, 系统工程]
stack: [C++17, CycloneDDS, iceoryx, CMake]
status: 维护中
links:
  - { label: GitHub, href: "https://github.com/" }
  - { label: 调参笔记, href: "/posts/dds-qos-tuning/" }
cover: assets/bg/neon.jpg
featured: true
order: 1
---

把机器人项目里反复要写的 DDS 那一层抽出来：预置 QoS 组合、共享内存传输、编码器注册，外加一套能直接跑出延迟直方图的压测工具。

## 解决什么问题

每个机器人项目立项时都要重新调一遍 DDS：QoS 怎么配、共享内存怎么开、延迟抖动到底多大。这些工作重复且容易出错，尤其是 QoS 组合配错时症状很隐蔽——能通信，但抖动大。

## 包含什么

- `qos_profiles/` — 5 组预置 QoS（传感器流 / 控制指令 / 参数 / 状态上报 / 大消息）
- `transport/` — CycloneDDS + iceoryx 共享内存的统一开关，编译期可选
- `codec/` — IDL 生成 + 手写零拷贝类型注册
- `probe/` — 延迟直方图与丢包统计（p50/p99/最坏）
- `discovery/` — 单播发现 + 静态对端的配置生成器

## 预置 QoS 组合

| Profile | Reliability | History | Durability | Deadline | 用途 |
|---|---|---|---|---|---|
| `sensor_stream` | BEST_EFFORT | KEEP_LAST(1) | VOLATILE | — | IMU / 关节 / 力 |
| `control_cmd` | BEST_EFFORT | KEEP_LAST(1) | VOLATILE | 2 ms | 力矩/位置指令 |
| `config` | RELIABLE | KEEP_LAST(1) | TRANSIENT_LOCAL | — | 参数下发 |
| `telemetry` | RELIABLE | KEEP_LAST(10) | TRANSIENT_LOCAL | — | 状态上报 |
| `bulk` | BEST_EFFORT | KEEP_LAST(1) | VOLATILE | — | 点云 / 图像 |

用法：

```cpp
#include <dds_kit/dds_kit.hpp>

dds_kit::Publisher<JointCommand> cmd_pub(node, "/joint_cmd",
    dds_kit::qos::control_cmd(/*deadline_ms=*/2));

// 零拷贝发布（同进程共享内存）
auto sample = cmd_pub.loan();
fill(sample);
cmd_pub.publish(std::move(sample));
```

## 压测结果

一台 Orin + 一台 x86，千兆直连，1 KB 消息 @ 1 kHz：

| 配置 | 延迟均值 | p99 | 最坏 | 丢包率 |
|---|---:|---:|---:|---:|
| 默认 ROS 2 / UDP | 425 µs | 2.5 ms | 12 ms | 0% |
| kit / BEST_EFFORT + init | 168 µs | 420 µs | 1.4 ms | 0.02% |
| kit + 共享内存（同机） | 61 µs | 96 µs | 180 µs | 0% |
| kit + 单播发现 + 隔离核 | 48 µs | 74 µs | 132 µs | 0% |

::: tip 压测工具怎么用
```bash
dds_probe pub --topic /joint_cmd --rate 1000 --size 1024 --profile control_cmd
dds_probe sub --topic /joint_cmd --duration 30 --histogram out.csv
python tools/plot_hist.py out.csv     # 输出 p50/p99/max 与分布图
```
:::

## 实测约束

- iceoryx 的共享内存池需要显式配置大小，消息超过池上限会静默退回 UDP（很容易误以为共享内存没生效）
- CycloneDDS 的 `MaxAutoParticipantIndex` 默认 10，节点多了会启动失败，要调大
- Windows 上共享内存不可用，只能走 UDP
