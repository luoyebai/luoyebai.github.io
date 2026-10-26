---
title: 标定：相机与手眼
slug: camera-handeye-calibration
collection: vision
order: 6
tags: [OpenCV, 相机标定, 手眼标定, 机器人, 视觉组教程]
summary: 从相机内参到眼在手上的外参求解，明确坐标变换方向、采样要求与独立验证方法。
---

# 标定：相机与手眼


--

目标：知道每个矩阵把哪个坐标系变换到哪里，能组织数据、调用标定接口并检查结果。


--

基线：OpenCV 4.x、Python 3；手眼部分采用**眼在手上**、标定板固定在工作空间的配置。

----
## 两种标定分别求什么


--

| 标定 | 输出 | 作用 |
|---|---|---|
| 相机内参 | K、畸变系数 | 连接相机三维坐标与像素 |
| 单帧目标位姿 | 目标到相机的变换 | 解释标定板相对相机的位置 |
| 手眼外参 | 相机到末端的固定变换 | 把视觉结果接到机器人坐标链 |


--

内参会受焦距、分辨率和图像裁剪影响；手眼外参会受安装变化影响。

----
## 用明确记号避免方向混乱


--

记 `T_A_B` 为“把 B 坐标变换到 A 坐标”的 4×4 齐次矩阵。


--

```text
p_A = T_A_B · p_B
T_A_C = T_A_B · T_B_C
inverse(T_A_B) = T_B_A
```


--

其中点使用齐次形式 `[x, y, z, 1]`。
组合前检查中间坐标标签是否相同；长度统一使用米，旋转明确使用矩阵、旋转向量或四元数及其约定。

----
## 相机投影模型


--

忽略畸变时：


--

```text
u = fx · Xc / Zc + cx
v = fy · Yc / Zc + cy
K = [[fx, 0, cx], [0, fy, cy], [0, 0, 1]]
```


--

焦距和主点以像素计。透视投影需要深度，单个像素不能唯一确定空间点。
普通针孔畸变与鱼眼模型不同，应根据镜头选择接口，不能混用系数。

----
## 采集内参图像


--

使用平整标定板，记录**内角点**的列数、行数与方格边长。


--

- 覆盖图像中心、边缘和角落。

--

- 改变倾角、距离和位置，避免全部正对且距离相同。

--

- 保持焦距、分辨率和对焦策略一致。

--

- 排除严重模糊、遮挡和错误角点；保留原图供复查。


--

可以从二十张左右的多姿态图像开始，但有效覆盖比固定张数更重要。

----
## 建立对应点


--

示例：9 列 × 6 行内角点、方格边长 0.025 m。


--

```python
import cv2
import numpy as np
pattern = (9, 6)
object_points = np.zeros((pattern[0] * pattern[1], 3), np.float32)
object_points[:, :2] = np.mgrid[0:9, 0:6].T.reshape(-1, 2) * 0.025
```


--

每张有效图像配对一组板面三维点与同序像素角点。
本课提供 [完整内参脚本](/assets/docs/camera-handeye-calibration/calibrate_camera.py)：检测、校验尺寸、计算误差并保存参数。

----
## 运行内参实验


--

在已安装 `opencv-python` 的虚拟环境中，将图像放到独立的 `images/`：


--

```bash
python calibrate_camera.py --images images --cols 9 --rows 6 --square 0.025 --output camera.npz
```


--

输出总体 RMS、逐帧重投影 RMS，并保存 `K`、`dist`、图像尺寸等数据。
RMS 以像素计，不是机器人末端的毫米误差，也没有对所有镜头通用的合格阈值。

----
## 留出独立图像验证


--

用未参与内参拟合的标定板图像，固定 K 与畸变，通过 PnP 估计每张图的位姿，再比较观测角点与重投影。


--

检查误差在画面边缘是否明显变大，并看直线去畸变后的形状。
仅删除高误差图以压低训练 RMS，可能掩盖覆盖不足或模型不适合的问题。


--

图像缩放需相应缩放焦距与主点；裁剪还需平移主点坐标。

----
## 单帧 solvePnP 的输出方向


--

```python
ok, rvec, tvec = cv2.solvePnP(object_points, image_points, K, dist)
if not ok:
    raise RuntimeError('PnP failed')
R, _ = cv2.Rodrigues(rvec)
```


--

这是接口片段，`image_points` 来自该帧角点，K/dist 来自内参标定。
输出表示 **target → camera**，即 `T_camera_target`；平移单位跟三维标定板点一致。
还应检查正深度、重投影误差与相邻帧连续性。

----
## 眼在手上的坐标链


--

标定板固定，相机固定在末端。每帧满足：


--

```text
T_base_gripper(i) · T_gripper_camera · T_camera_target(i)
    = T_base_target  （应保持不变）
```


--

已知机器人末端位姿与视觉 PnP 位姿，未知中间固定变换。
必须确认机器人接口给的是 gripper→base 还是反方向；不要只按变量名猜测。

----
## AX = XB 从哪里来


--

令 `G_i = T_base_gripper(i)`，`C_i = T_camera_target(i)`，未知 `X = T_gripper_camera`。


--

```text
G_i X C_i = G_j X C_j
A = inverse(G_j) G_i
B = C_j inverse(C_i)
A X = X B
```


--

成对运动消去了固定标定板在 base 中的位姿。
只有平移、或所有旋转都绕同一轴，会造成信息不足；应采集多个非平行旋转轴与丰富姿态。

----
## 调用手眼接口


--

对每帧保存对应的旋转矩阵和平移向量列表，长度与顺序必须一致：


--

```python
R_cam2gripper, t_cam2gripper = cv2.calibrateHandEye(
    R_gripper2base, t_gripper2base,
    R_target2cam, t_target2cam,
    method=cv2.CALIB_HAND_EYE_PARK)
```


--

输出正是 `T_gripper_camera`。这是数据接口片段，不包含机器人采集驱动。
拍照时等待机器人稳定，配对同一时刻的位姿，避免运动延迟混入空间外参。


--

所有帧还必须使用同一个标定板原点与轴方向。对称棋盘可能出现角点顺序翻转，手眼采集应标记方向或使用带唯一标识的标定板，并检查位姿连续性。

----
## 验证比“返回矩阵”更重要


--

对未参与求解的新姿态计算 `G_i X C_i`，比较它们的平移与旋转散布。


--

再用独立目标验证视觉点变换到 base 的位置，记录毫米误差与角度误差。
如果只有训练姿态好，检查覆盖、退化、时间同步、板尺寸和机器人运动学误差。


--

眼在手外的固定相机拓扑不同，不能原样套用上面的输入方向。

----
## 练习与答案


--

把方格边长从 25 mm 错填为 25 m，会发生什么？


--

**答案**：尺度扩大 1000 倍，PnP 平移也按该尺度变化；若机器人平移仍用米，手眼数据不再一致。
重投影误差仍可能很小，因此低像素误差不能证明尺度正确。


--

参考：[OpenCV 相机与手眼标定接口](https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html)、[相机标定教程](https://docs.opencv.org/4.x/dc/dbb/tutorial_py_calibration.html)。
