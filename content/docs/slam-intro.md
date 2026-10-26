---
title: SLAM 入门
slug: slam-intro
collection: vision
order: 5
tags: [SLAM, ROS2, 激光雷达, 定位, 视觉组教程]
summary: 区分定位、建图与导航，从里程计和回环理解 SLAM，并跑通 ROS 2 二维激光建图的检查流程。
---

# SLAM 入门


--

SLAM：Simultaneous Localization and Mapping，同时估计运动轨迹与环境地图。


--

目标：解释漂移和回环，检查输入与 TF，理解一张地图是否可信。
实践基线：ROS 2 Jazzy、二维激光、SLAM Toolbox。

----
## 定位、建图、导航不是一件事


--

| 任务 | 主要问题 |
|---|---|
| 里程计 | 相邻时刻如何运动？ |
| 定位 | 相对于已有地图，我在哪里？ |
| SLAM | 地图未知时，轨迹和地图如何一起估计？ |
| 导航 | 如何规划并控制机器人到达目标？ |


--

SLAM 地图可以供导航使用，但 SLAM 本身不保证避障、路径规划或运动安全。

----
## 为什么会漂移


--

轮编码器、IMU、图像和激光都存在噪声、偏差或退化条件。
把局部运动估计不断累积，会使全局轨迹逐渐偏离。


--

例如轮滑会破坏纯轮速里程计；长直走廊可能让激光匹配在某个方向约束不足。
增加传感器不自动消除问题，还需要时间同步、标定与合理融合。

----
## 前端、后端与回环


--

```text
传感器 → 特征或扫描匹配 → 局部运动约束
历史观测 → 回环候选 → 几何验证
所有约束 → 后端优化 → 更新轨迹与地图
```


--

回环表示“可能再次看到了同一个地方”，必须验证。
错误回环会把地图拉歪，不能只看是否出现闭合就判断系统变好了。

----
## 位姿图：点与边分别是什么


--

点代表待估计位姿，边代表里程计或回环测量的相对关系。
优化寻找一组位姿，让预测关系与观测关系的加权残差尽量小。


--

需要固定一个参考坐标来消除整体平移和旋转的不确定性。
权重来自测量可信程度；鲁棒损失可减弱异常边影响，但不能代替错误数据排查。

----
## 坐标树与发布责任


--

```text
map → odom → base_link → laser
```


--

- 里程计提供 `odom → base_link`：短期连续，允许慢慢漂移。

--

- SLAM 提供 `map → odom`：校正全局漂移，优化时可能调整。

--

- 机器人模型提供 `base_link → laser`：实际安装关系。


--

每条关系指定一个发布者，避免另一个定位节点同时发布冲突的 `map → odom`。

----
## 启动前先检查输入


--

```bash
ros2 topic info /scan --verbose
ros2 topic hz /scan
ros2 run tf2_ros tf2_echo odom base_link
ros2 run tf2_ros tf2_echo base_link laser
```


--

把 `laser` 换成扫描消息实际的 `header.frame_id`。
检查角度、量程单位、采样时间与扫描范围；只有 TF 名称对上仍不够，外参必须与实际一致。

----
## 安装与复制参数


--

以下假设 ROS 官方 apt 源已配置，传感器或仿真已能提供上一页的输入。


--

```bash
sudo apt install ros-jazzy-slam-toolbox ros-jazzy-nav2-map-server
source /opt/ros/jazzy/setup.bash
mkdir -p "$HOME/slam-lab"
cd "$HOME/slam-lab"
cp "$(ros2 pkg prefix slam_toolbox)/share/slam_toolbox/config/mapper_params_online_async.yaml" mapper.yaml
```


--

检查文件中的 `map_frame`、`odom_frame`、`base_frame`、`scan_topic`，按实际系统修改，不直接改系统安装目录。

----
## 启动并观察


--

仿真或 rosbag `/clock` 场景：


--

```bash
ros2 launch slam_toolbox online_async_launch.py \
  slam_params_file:="$HOME/slam-lab/mapper.yaml" use_sim_time:=true
```


--

实机使用系统时间时改为 `use_sim_time:=false`，其他节点保持一致。
在 RViz 以 `map` 为 Fixed Frame，显示 Map、LaserScan 和 TF。


--

先慢速走小范围，观察墙面是否重叠，再尝试闭环；优先在录包或仿真中完成练习。

----
## 保存地图不等于保存全部 SLAM 状态


--

在地图已发布、map saver 可正常订阅后：


--

```bash
mkdir -p "$HOME/slam-lab/maps"
ros2 run nav2_map_server map_saver_cli -f "$HOME/slam-lab/maps/room"
```


--

输出 YAML 与栅格图像，可供地图定位与导航使用。
如果要继续优化或增量建图，还需 SLAM Toolbox 的 pose graph 序列化；栅格地图不能恢复完整约束图。

----
## 用失败现象定位问题


--

| 现象 | 优先检查 |
|---|---|
| 墙体双影 | 时间同步、外参、运动畸变 |
| 地图缓慢弯曲 | 里程计偏差、匹配退化、回环不足 |
| 回环后突然折叠 | 错误回环、异常约束 |
| TF 超时 | 时间源、缓冲范围、缺失变换 |


--

这些是候选原因，不是一一对应的判决。用同一份录包一次只改一项参数，保留对比结果。

----
## 验收与参考


--

练习：在一段包含回环的录包中，比较起终点附近墙面、重复结构和轨迹连续性。


--

**答案要点**：没有真值时不能报告真实定位精度；应报告地图一致性、回环行为与失败场景。有真值时再计算轨迹误差，并说明坐标对齐方式。


--

参考：[SLAM Toolbox 项目与说明](https://github.com/SteveMacenski/slam_toolbox)、[Jazzy 启动文件](https://github.com/SteveMacenski/slam_toolbox/blob/jazzy/launch/online_async_launch.py)、[REP-105 坐标约定](https://www.ros.org/reps/rep-0105.html)。
