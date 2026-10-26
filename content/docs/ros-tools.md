---
title: 节点和工具
slug: ros-tools
collection: vision
order: 2
tags: [ROS2, QoS, tf2, launch, 视觉组教程]
summary: 按任务语义选择通信方式，正确检查 QoS、TF 与时钟，并用命令行和录包定位问题。
---

# 节点和工具


--

基线：ROS 2 Jazzy。目标：面对“看得见话题却收不到数据”，能按层次排查。

----
## 按任务语义选择接口


--

| 接口 | 用途 | 例子 |
|---|---|---|
| Topic | 连续流、状态广播 | 图像、里程计 |
| Service | 较快完成的请求与响应 | 查询配置、复位请求 |
| Action | 有反馈、结果和取消请求的任务 | 导航到目标、执行轨迹 |


--

服务可以异步调用，不必阻塞线程；动作的取消也需要服务端接受并实施。
Action 协议由三个服务与两个话题组成。不要按固定的“10 Hz / 1 秒”阈值机械分类。

----
## 可靠传输不等于任务已完成


--

`reliable` 处理的是通信层可靠性，不代表执行器已成功动作。


--

重要命令应有明确的确认、结果、超时和重复请求处理方式。
周期性发布状态有助于观察当前情况，但状态消息同样可能丢失或过期。


--

例如“使能”应结合设备反馈判断，不应只凭 publish 返回就认定成功。

----
## QoS 需要同时考虑兼容与资源


--

<!--fig:ros-qos-->


--

Reliability 与 durability 等策略参与端点兼容；history/depth 控制缓存，**不是发布深度必须大于订阅深度**。


--

Deadline 用于表达期望周期及检测错过期限，不负责强制调度回调。
Lifespan 限制消息有效期；可靠传输不能使过期数据重新有效。

----
## 两张常用兼容表


--

| 发布可靠性 | 订阅可靠性 | 兼容 |
|---|---|---|
| best_effort | best_effort | 是 |
| best_effort | reliable | 否 |
| reliable | best_effort | 是 |
| reliable | reliable | 是 |


--

订阅者要求 transient_local 而发布者是 volatile 时不兼容。
要获得发布者保留的历史样本，双方都使用 transient_local，并考虑缓存与发布者存活状态。


--

具体 deadline 均非默认值时，发布方提供的间隔应不大于订阅方请求间隔。

----
## 交互实验：只检查两项策略


--

```js run
function compatible(pub, sub) {
  return !(sub.reliability === 'reliable' && pub.reliability === 'best_effort')
    && !(sub.durability === 'transient_local' && pub.durability === 'volatile');
}
const cases = [
  ['reliable', 'best_effort', 'volatile', 'volatile', true],
  ['best_effort', 'reliable', 'volatile', 'volatile', false],
  ['reliable', 'reliable', 'volatile', 'transient_local', false],
  ['reliable', 'reliable', 'transient_local', 'transient_local', true],
];
for (const [p, s, pd, sd, expected] of cases) {
  const result = compatible({reliability:p, durability:pd}, {reliability:s, durability:sd});
  if (result !== expected) throw new Error('compatibility regression');
  demo.log(`${p}/${pd} → ${s}/${sd}: ${result ? '兼容' : '不兼容'}`);
}
```


--

这不是完整 RMW 检查器；liveliness、deadline 等策略仍需单独核对。

----
## 收不到数据：逐层排查


--

```bash
ros2 node list
ros2 topic list -t
ros2 topic info /image_raw --verbose
ros2 topic echo /image_raw --qos-reliability best_effort --once
ros2 topic hz /image_raw
```


--

确认话题名、类型、端点数量、QoS，然后检查 `ROS_DOMAIN_ID`、网络和发现配置。
CLI 也是订阅者；`hz` 测得的是它接收到的频率，可能受 QoS、负载与网络影响。
大图像的文本输出很多，可优先查看元数据或使用图像工具。

----
## TF 是带时间的坐标关系


--

<!--fig:ros-tf-->


--

常见链路：`map → odom → base_link → camera_link`。
每个子坐标系应只有一个父坐标系，避免环与重复发布者。


--

```bash
ros2 run tf2_ros tf2_echo base_link camera_link
ros2 run tf2_tools view_frames
```


--

环、断树和时间过期是不同问题。`TF_OLD_DATA` 通常指旧时间数据，不能直接当成“存在环”的诊断。

----
## 静态、动态与时钟


--

固定安装关系用静态 TF；关节和机器人位姿随时间变化，用动态 TF。
静态 TF 表达时间不变的关系，并通过持久化策略供晚加入者获取。


--

多机需同步时钟；仿真与 rosbag 回放按配置统一 `use_sim_time` 和 `/clock`。
消息存在却查询不到 TF，先检查采样时间是否落在变换缓冲范围内。

----
## 用录包保留现场


--

```bash
ros2 bag record /scan /tf /tf_static /odom
ros2 bag info ./你的录包目录
ros2 bag play ./你的录包目录 --clock
```


--

回放时让相关节点使用仿真时间，避免同时运行原始传感器或重复 TF 发布者。
确认静态 TF 与必要配置已被保存；录制与回放 QoS 有特殊需求时使用覆盖配置。

----
## launch 描述接线


--

下面是结构示意；`camera` 与 `detector` 需替换为实际安装的包和可执行程序。


--

```python
from launch import LaunchDescription
from launch_ros.actions import Node
def generate_launch_description():
    return LaunchDescription([
        Node(package='camera', executable='camera_node', namespace='robot1'),
        Node(package='detector', executable='detect_node',
             remappings=[('image_raw', '/robot1/image_raw')]),
    ])
```


--

参数配置算法行为，命名空间与重映射配置连接关系。日志中保留节点名、时间和关键状态变化。

----
## 练习与参考


--

发布者是 reliable、depth=1；订阅者是 best_effort、depth=10，仅这两项会导致不兼容吗？


--

**答案**：不会。可靠性组合兼容，depth 差异本身不是端点兼容条件；仍需检查其他策略与实际处理速度。


--

参考：[ROS 2 QoS 官方说明](https://docs.ros.org/en/jazzy/Concepts/Intermediate/About-Quality-of-Service-Settings.html)、[Action 设计](https://design.ros2.org/articles/actions.html)、[tf2 教程](https://docs.ros.org/en/jazzy/Tutorials/Intermediate/Tf2/Tf2-Main.html)。
