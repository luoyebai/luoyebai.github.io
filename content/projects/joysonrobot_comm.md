---
title: joysonrobot_comm
slug: joysonrobot_comm
tagline: 基于 Fast-DDS 的发布订阅与 RPC 封装，含 IDL 代码生成
date: 2026-04-02
tags: [DDS, 中间件, 系统工程]
stack: [C++17, Fast-DDS, gRPC, CMake]
status: 维护中
links:
  - { label: GitHub, href: "https://github.com/luoyebai/joysonrobot_comm" }
  - { label: 调参笔记, href: "/posts/dds-qos-tuning/" }
cover: assets/bg/neon.jpg
featured: true
order: 1
updated: 2026-09-30
summary: 把机器人通信里反复要重做的那部分收进一个库：DDS 发布订阅、RPC 服务、IDL 生成代码，以及与 ROS 2 的互通。
---

机器人项目里通信层每次都要重来一遍：topic 命名各不相同、类型定义散落在各处、换一台机器又要重新接一遍。这个库把其中稳定的部分收拢起来——基于 [Fast-DDS](https://github.com/eProsima/Fast-DDS) 的发布订阅与对应的 RPC 服务，配一套从 IDL 生成代码的流程，测试用 [Catch2](https://github.com/catchorg/Catch2)。C++17 + CMake，目标平台是 Linux。

模块划分参考了 [Booster Robotics SDK](https://github.com/BoosterRobotics/booster_robotics_sdk) 的组织方式，并按实际使用做了扩展。

## 仓库里有什么

| 目录 | 内容 |
|---|---|
| `include/` `src/` | COMM 的头文件与实现 |
| `idl/` | 通信用的 IDL 定义 |
| `third_party/scripts/ddsgen/` | 从 IDL 生成代码的脚本 |
| `tests/` | 测试代码 |
| `python/` | Python 接口绑定（2.1.0 之后已移到 jsrsdk） |

## IDL 与代码生成

类型定义集中在 `idl/`，生成器在 `third_party/scripts/ddsgen/`（需要 `openjdk17-jdk`）：先 `./gradlew assemble` 构建工具，再 `./run.sh <FILE_NAME>` 生成到 `idl/genfiles/`，随后用 `-DREGEN_IDL=ON` 构建，生成物会被拷到 `include/idl` 与 `src/idl`。

**标识符只用英文**：IDL 里写中文会被生成器拒绝，这一步要一次写对，否则报错信息很不直观。

## 与 ROS 2 互通

话题名遵循 ROS 2 的约定，写成 `rt/xxx`（`rt` 是 ROS TOPIC 的缩写，`xxx` 是 ROS 2 侧发现的话题名），并要求 ROS 2 里的 msg 接口与 IDL 对得上。这条通道适合让 COMM 写的节点和已有的 ROS 2 生态对接，而不是替代 ROS 2。

## 依赖与构建

```bash
sudo apt-get update
sudo apt-get install cmake build-essential python3-dev python3-pip
sudo apt-get install libtinyxml2-dev libssl-dev          # DDS 依赖
sudo apt-get install pkg-config libprotobuf-dev libgrpc++-dev
sudo apt-get install protobuf-compiler protobuf-compiler-grpc
```

```bash
mkdir build && cd build
cmake -DCMAKE_INSTALL_PREFIX=/usr ..
make -j$(nproc)
make test            # 在 build/tests 下跑测试
sudo make install
```

在别的工程里用有两种方式：装到系统里之后 `find_package(jsrcomm REQUIRED)`，再 `target_link_libraries(<TARGET> PRIVATE jsrcomm fastcdr fastrtps)`；或者直接放一份预编译产物到 `third_party/jsrcomm/{lib,include}` 里链接。

## 几个环境上的坑

- **tinyxml 必须是 9.0.0**，版本对不上会直接构建失败。
- `undefined symbol: …fastcdr3Cdr9serializeEt` 基本是 **libfastcdr 被别的库顶掉了**：ROS 2 自带一份 `libfastcdr.so.2`，会把项目里那份覆盖掉。用 `ldd` 确认实际加载的是哪一个，构建时**不要** source ROS 2 的环境；要一起用就在 CMake 里显式指定动态库路径。
- Ubuntu 20.04 上可能遇到 `GLIBCXX_3.4.30 not found`，需要自行编译 Fast DDS 并替换 `third_party/lib/<ARCH>/` 下的库。

## 边界与后续

已支持 DDS 异步 RPC 与 gRPC；MQTT 和 WebRTC 还没做。动态类型可以走 `examples/cpp` 里的 `pub_json` / `sub_json` / `pub_dynamic` / `sub_dynamic`，但**目前不支持动态 map 类型**。Python 接口在 2.1.0 之后移到 jsrsdk，本仓库不再维护。

仓库：<https://github.com/luoyebai/joysonrobot_comm>（Apache-2.0）。上面的构建步骤、目录结构与限制来自项目 README；QoS 与延迟测量上的取舍见 [DDS 选型与调参](/posts/dds-qos-tuning/)。
