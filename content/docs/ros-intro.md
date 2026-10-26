---
title: 初识 ROS
slug: ros-intro
collection: vision
order: 1
tags: [ROS, ROS2, 机器人, 中间件, 视觉组教程]
summary: 以 ROS 2 Jazzy 为实验基线，理解节点、话题、接口和发现机制，并完成一次可观察的通信。
---

# 初识 ROS


--

ROS 提供机器人软件的通信、工具与约定；进程调度和内存管理仍由操作系统负责。


--

本系列实验基线：**Ubuntu 24.04 + ROS 2 Jazzy**。命令需先完成官方安装并加载环境。

----
## 一台机器人由哪些部分协作


--

<!--fig:ros-graph-->


--

相机驱动发布图像，检测模块输出目标，规划器生成轨迹，控制器跟踪指令。


--

统一消息接口与通信机制，可以让模块分别开发与替换。
ROS 生态包含驱动和算法包，但具体硬件兼容性、控制性能和系统可靠性仍需验证。

----
## 节点不等于进程


--

- **节点**：有名称、参数和通信接口的逻辑组件。

--

- **进程**：操作系统管理的执行容器，一个进程可以包含多个节点。

--

- **话题**：按名称与消息类型组织的数据流。

--

- **包**：源码、接口、配置和可执行程序的组织单位。


--

独立进程便于隔离故障；组合节点可以减少部分通信开销，但共享崩溃影响与执行资源。

----
## 先运行官方示例


--

安装了示例包后，在两个终端分别执行：


--

```bash
source /opt/ros/jazzy/setup.bash
ros2 run demo_nodes_cpp talker
```


--

```bash
source /opt/ros/jazzy/setup.bash
ros2 run demo_nodes_py listener
```


--

预期 listener 持续收到消息。停止使用 Ctrl+C。
若包未安装，按 [Jazzy 安装文档](https://docs.ros.org/en/jazzy/Installation/Ubuntu-Install-Debs.html) 安装相应 demo 包。

----
## 让通信可观察


--

第三个已加载环境的终端：


--

```bash
ros2 node list
ros2 topic list -t
ros2 topic info /chatter --verbose
ros2 topic echo /chatter
```


--

分别查看节点、话题类型、端点配置与实际消息。
接口类型相同不代表业务含义自动一致；单位、坐标系、采样时间仍需约定。

----
## 时间戳不是所有消息都有


--

`std_msgs/msg/String` 只有字符串内容，没有 Header。
图像和点云等常用消息包含 Header，供接收方解释采样时间与坐标系。


--

录包时的接收时间，也不一定等于传感器采样时间。
多机时钟和仿真 `/clock` 必须统一，否则数据可能存在却无法在对应时间查询 TF。

----
## 一个完整的 Python 发布节点


--

保存为 `talker.py`，在加载 ROS 环境后执行 `python3 talker.py`：


--

```python
import rclpy
from rclpy.node import Node
from std_msgs.msg import String

def main():
    rclpy.init()
    node = Node('lesson_talker')
    publisher = node.create_publisher(String, 'chatter', 10)
    timer = node.create_timer(0.5, lambda: publisher.publish(String(data='hello')))
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()

if __name__ == '__main__':
    main()
```


--

`spin` 驱动回调执行；定时器不是独立的硬实时调度保证。

----
## ROS 1 与 ROS 2 的区别


--

ROS 1 Noetic 已于 2025 年 5 月 31 日结束官方支持。新项目应结合驱动与依赖优先评估受支持的 ROS 2 发行版。


--

ROS 2 通过 RMW 抽象通信实现，常见实现基于 DDS；具体发现与传输配置取决于所用 RMW。
QoS、生命周期与安全机制提供配置能力，但不会自动带来硬实时性或完整系统安全。


--

ROS 1 的 master 故障会影响注册与发现；已建立的连接不一定立即停止。ROS 1 也存在 nodelet 组合方式。

----
## 发现与 QoS 是不同的检查层


--

1. 网络、域与发现配置决定端点是否能够看见彼此。

--

2. 话题名和类型决定要连接哪种数据。

--

3. QoS 兼容规则决定端点能否通信。

--

4. Executor 与回调执行决定数据何时被业务处理。


--

可靠发布者可以匹配 best-effort 订阅者；best-effort 发布者不能满足 reliable 订阅者。
不兼容可通过事件或部分实现的警告发现，不能一概说“默认永远不报错”。

----
## 浏览器实验：取消一个订阅


--

这里模拟同步发布订阅关系，不模拟 DDS 的网络、队列或 QoS。


--

```js run
const listeners = new Set();
const subscribe = callback => {
  listeners.add(callback);
  return () => listeners.delete(callback);
};
const publish = message => listeners.forEach(fn => fn(message));
const stopDetection = subscribe(n => demo.log('检测器收到', n));
subscribe(n => demo.log('录制器收到', n));
for (let frame = 1; frame <= 4; frame++) {
  publish(frame);
  if (frame === 2) stopDetection();
}
```


--

预期：检测器收到第 1、2 帧；录制器收到全部 4 帧。修改订阅关系不需要改变发布循环。

----
## 练习与参考


--

将发布节点的话题改为 `status`，listener 是否自动收到？


--

**答案**：不会。需要修改订阅配置或使用重映射，例如 `--ros-args -r chatter:=status`。


--

接着阅读 [节点和工具](/docs/ros-tools/)。


--

参考：[ROS 2 节点概念](https://docs.ros.org/en/jazzy/Concepts/Basic/About-Nodes.html)、[QoS](https://docs.ros.org/en/jazzy/Concepts/Intermediate/About-Quality-of-Service-Settings.html)、[Noetic 支持结束公告](https://www.ros.org/blog/noetic-eol/)。
