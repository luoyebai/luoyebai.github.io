---
title: 用 SAM3 与 FoundationPose 做工件 6D 姿态估计
slug: sam3-foundationpose-6d-pose
date: 2025-12-26
tags: [机器视觉, 机械臂, ROS2]
summary: 免训练的 6D 姿态估计路线：SAM3 负责按语义把工件分出来，FoundationPose 只在给 CAD 数模和少量参考图的前提下估计并跟踪位姿。记录显存与耗时实测、姿态注册的旋转网格参数怎么调，以及精度不够时几条可落地的改进方向。
cover: assets/uploads/8xvppo-8xvppo-a9ab39deb6.webp
featured: false
draft: false
archived: false
---

::: warn 迁移说明
原文档的代码压缩包与模型权重不随本文转载；公司内网地址已替换为通用描述。
:::

## 概述

SAM3可通过语义、图例来分割物体：

https://docs.ultralytics.com/zh/models/sam-3

Foundationpose是一个用于 6D 物体姿态估计和跟踪的统一基础模型，它同时支持基于模型和无模型两种设置。只要给定物体的 CAD 模型或少量参考图像，我们的方法即可在测试时直接应用于新物体，无需微调：

https://github.com/NVlabs/FoundationPose

---

## 效果图

- SAM2 + Foundationpose 效果：

![SAM2 + FoundationPose 的分割与跟踪效果](/assets/feishu/sam3-foundationpose-6d-pose/video-01.mp4)

- 单SAM3 效果：

![截图 2025-12-19 09-09-12.png](/assets/feishu/sam3-foundationpose-6d-pose/fig-01.webp)

- SAM3 + Foundationpose 效果：

![SAM3 + FoundationPose 的分割与跟踪效果](/assets/feishu/sam3-foundationpose-6d-pose/video-02.mp4)

![图片.png](/assets/feishu/sam3-foundationpose-6d-pose/fig-02.webp)

- SAM3分割时显存占用4G，Foundationpose追踪姿态显存占用3G。

- 目前该 Demo 使用 ROS2 Humble 进行通讯，RealSense相机，4070TiS 显卡下SAM3推理时间约 20~25ms。

- Foundationpose 在物体快速运动时会出现姿态估计错误，这是因为相机帧率仅 30fps，高速运动时RGB 图像会出现严重拖影。

- 使用该方案时，仅需提供工件3d数模（obj、stl格式等），分割通过语义进行。

---

## 代码与模型

原方案的两份代码压缩包与 SAM3 权重（约 3 GB）都不随本文转载。要复现的话，姿态估计直接用 NVlabs 的 [FoundationPose](https://github.com/NVlabs/FoundationPose) 官方实现，分割用 [Ultralytics SAM 3](https://docs.ultralytics.com/zh/models/sam-3)，两者之间只需要把 mask 递过去 —— 这也是这套方案省事的地方，不必为每个新工件重新训练或微调。

---

## 环境搭建

按 FoundationPose 仓库的 README 建环境：CUDA + PyTorch + nvdiffrast，外加 RealSense 的 ROS 2 驱动。这套依赖里最费时间的是 nvdiffrast 与 PyTorch / CUDA 的版本对齐，建议直接用仓库自带的镜像起，别在裸机上从零配。

---

## C++绑定和性能优化

![图片.png](/assets/feishu/sam3-foundationpose-6d-pose/fig-03.webp)

耗费时间最长的地方为

```python
pose_data = make_crop_data_batch(self.cfg.input_resize, B_in_cams, mesh_centered, rgb_tensor, depth_tensor, K, crop_ratio=crop_ratio, normal_map=normal_map,
                                         xyz_map=xyz_map_tensor, cfg=self.cfg, glctx=glctx, mesh_tensors=mesh_tensors, dataset=self.dataset, mesh_diameter=mesh_diameter)

```

初次执行时，会通过下面这个函数进行姿态猜测，默认会生成252个姿态，参数修改为12、90后，注册时长为700ms

```python
def make_rotation_grid(self, min_n_views=40, inplane_step=60):
        cam_in_obs = sample_views_icosphere(n_views=min_n_views)
        # logging.info(f'cam_in_obs:{cam_in_obs.shape}')
        rot_grid = []
        for i in range(len(cam_in_obs)):
            for inplane_rot in np.deg2rad(np.arange(0, 360, inplane_step)):
                cam_in_ob = cam_in_obs[i]
                R_inplane = euler_matrix(0, 0, inplane_rot)
                cam_in_ob = cam_in_ob @ R_inplane
                ob_in_cam = np.linalg.inv(cam_in_ob)
                rot_grid.append(ob_in_cam)

        rot_grid = np.asarray(rot_grid)
        # logging.info(f"rot_grid:{rot_grid.shape}")
        rot_grid = mycpp.cluster_poses(
            30, 99999, rot_grid, self.symmetry_tfs.data.cpu().numpy())
        rot_grid = np.asarray(rot_grid)
        # logging.info(f"after cluster, rot_grid:{rot_grid.shape}")
        self.rot_grid = torch.as_tensor(
            rot_grid, device='cuda', dtype=torch.float)
        # logging.info(f"self.rot_grid: {self.rot_grid.shape}")
```

测试不同inplane_step下该模型效果和性能：

![inplane_step 取不同值时的注册效果对比](/assets/feishu/sam3-foundationpose-6d-pose/video-03.mp4)

inplane_step 使用 120时，姿态估计出现严重错误，该参数最佳配置为90左右。

---

## G2 本体测试

![g2_vis.jpg](/assets/feishu/sam3-foundationpose-6d-pose/fig-04.webp)

![g2_dep.jpg](/assets/feishu/sam3-foundationpose-6d-pose/fig-05.webp)

G2 本体相机可视化效果如上，使用该方案：

![机械臂本体相机上的分割结果](/assets/feishu/sam3-foundationpose-6d-pose/video-04.mp4)

姿态估计存在问题，需要进一步测试，更接近工件以便于更好的深度估计。

---

## 精度优化方案

### 基于规则接近工件提高精度

#### 旋转将mask对齐

G2 在分割出工件时同时通过像素偏移计算机器人旋转角度，将工件置于相机光学中心，可以提升深度估计的精度。

#### 俯身接近工件

G2 在第一次识别到工件后，通过该坐标进行移动，俯身接近该工件进行二次精定位，再进行抓取。

### 外接传感器

手部外接一个realsense，G2先通过头部坐标粗定位，再通过手部realsense进行精定位。

### VL 方案

通过 VL 控制机器人具体的Action，自动化行为序列，并回滚特殊case。
