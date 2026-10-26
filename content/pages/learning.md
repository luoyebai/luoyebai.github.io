---
title: 学习路线
slug: learning
date: 2026-10-02
summary: 从前置知识走到工程实践，把文章、课件和浏览器实验串成三条可以接着读的路线。
cover: assets/uploads/13dz2g-13dz2g-6126e628a2.webp
featured: false
draft: false
archived: false
order: 80
---

<div class="learning-intro"><span class="direction-number">LEARNING PATHS / 先理解，再动手</span><p>每一步都连到本站已有内容。可以按顺序读，也可以从熟悉的节点跳入；阅读位置仅保存在当前浏览器，不需要登录。</p><a href="/graph/">自由探索三维书库 ↗</a></div>

<div class="route-controls" data-route-controls role="group" aria-label="选择学习方向" hidden><button type="button" data-route-filter="all" aria-pressed="true">全部路线</button><button type="button" data-route-filter="middleware" aria-pressed="false">中间件</button><button type="button" data-route-filter="motion" aria-pressed="false">运动控制</button><button type="button" data-route-filter="rl" aria-pressed="false">强化学习与部署</button></div>

<section class="learning-path" id="middleware" data-learning-path="middleware">
<header class="path-heading"><span class="direction-number">01 / MIDDLEWARE</span><h2>让数据按约定抵达</h2><p>先把程序运行起来，再理解通信语义，最后判断数据是否来得及使用。</p></header>
<ol class="path-steps">
<li><a href="/docs/linux-intro/" data-reading-url="/docs/linux-intro/"><span class="path-kind">前置 · 课件</span><h3>初识 Linux</h3><p>建立练习环境，熟悉路径、权限与命令行。</p><span data-reading-status>未开始</span></a></li>
<li><a href="/docs/cpp-build-packages/" data-reading-url="/docs/cpp-build-packages/"><span class="path-kind">工具 · 课件</span><h3>C++ 构建与包管理</h3><p>把源代码变成可以重复构建和测试的工程。</p><span data-reading-status>未开始</span></a></li>
<li><a href="/docs/ros-intro/" data-reading-url="/docs/ros-intro/"><span class="path-kind">通信 · 课件</span><h3>ROS 2 通信基础</h3><p>认识节点、话题、服务与消息的组织方式。</p><span data-reading-status>未开始</span></a></li>
<li><a href="/posts/dds-qos-tuning/" data-reading-url="/posts/dds-qos-tuning/"><span class="path-kind">深入 · 文章与实验</span><h3>DDS 与 QoS</h3><p>比较队列与交付策略，观察延迟怎样累积。</p><span data-reading-status>未开始</span></a></li>
<li><a href="/posts/realtime-control-loop/" data-reading-url="/posts/realtime-control-loop/"><span class="path-kind">验证 · 文章</span><h3>控制回路的实时性</h3><p>区分周期、执行时间、数据年龄与截止时间。</p><span data-reading-status>未开始</span></a></li>
</ol>
<a class="path-result" href="/projects/joysonrobot_comm/">实践出口 <strong>joysonrobot_comm · 通信工具库</strong><span aria-hidden="true">↗</span></a>
</section>

<section class="learning-path" id="motion" data-learning-path="motion">
<header class="path-heading"><span class="direction-number">02 / MOTION CONTROL</span><h2>从一个目标到一段动作</h2><p>带着坐标、模型与接口三个问题，逐步理解运动控制。</p></header>
<ol class="path-steps">
<li><a href="/docs/ros-tools/" data-reading-url="/docs/ros-tools/"><span class="path-kind">前置 · 课件</span><h3>ROS 工具与坐标</h3><p>先看清系统中的坐标关系和观测数据。</p><span data-reading-status>未开始</span></a></li>
<li><a href="/posts/parallel-ankle-kinematics/" data-reading-url="/posts/parallel-ankle-kinematics/"><span class="path-kind">模型 · 文章</span><h3>并联机构运动学</h3><p>连接电机角度、足端姿态与雅可比矩阵。</p><span data-reading-status>未开始</span></a></li>
<li><a href="/posts/quadruped-mpc-kinematics/" data-reading-url="/posts/quadruped-mpc-kinematics/"><span class="path-kind">规划 · 文章</span><h3>四足运动学与 MPC</h3><p>沿着状态转移、代价函数和约束理解控制设计。</p><span data-reading-status>未开始</span></a></li>
<li><a href="/posts/arm-impedance-control/" data-reading-url="/posts/arm-impedance-control/"><span class="path-kind">接触 · 文章与实验</span><h3>阻抗与力位混合控制</h3><p>在交互实验里感受刚度、阻尼与负载的关系。</p><span data-reading-status>未开始</span></a></li>
</ol>
<a class="path-result" href="/lab/">实践出口 <strong>把控制环调稳 · 浏览器挑战</strong><span aria-hidden="true">↗</span></a>
</section>

<section class="learning-path" id="rl" data-learning-path="rl">
<header class="path-heading"><span class="direction-number">03 / SIM2REAL</span><h2>为策略走出仿真做准备</h2><p>这条路线聚焦编程、仿真与部署前置知识。训练算法需要另行系统学习，完成这些节点并不代表已经掌握强化学习。</p></header>
<ol class="path-steps">
<li><a href="/docs/python-first/" data-reading-url="/docs/python-first/"><span class="path-kind">前置 · 课件</span><h3>从 Python 入手</h3><p>掌握环境、对象、异常和可执行测试。</p><span data-reading-status>未开始</span></a></li>
<li><a href="/docs/ros-sim/" data-reading-url="/docs/ros-sim/"><span class="path-kind">仿真 · 课件</span><h3>建立机器人仿真环境</h3><p>核对模型、时间和输入输出，再解释仿真结果。</p><span data-reading-status>未开始</span></a></li>
<li><a href="/posts/small-humanoid-consensus/" data-reading-url="/posts/small-humanoid-consensus/"><span class="path-kind">硬件 · 文章</span><h3>小型人形机器人的系统约束</h3><p>把关节、算力、传感器与通信接口放在一起看。</p><span data-reading-status>未开始</span></a></li>
<li><a href="/posts/humanoid-0-to-1-toolchain/" data-reading-url="/posts/humanoid-0-to-1-toolchain/"><span class="path-kind">部署 · 文章</span><h3>从 URDF 到真机工具链</h3><p>梳理模型、通信、仿真验证和部署之间的接口。</p><span data-reading-status>未开始</span></a></li>
</ol>
<a class="path-result" href="/lab/">实践出口 <strong>用延迟和噪声，观察模型外的变化</strong><span aria-hidden="true">↗</span></a>
</section>

<div class="learning-outro"><h2>把理解变成一个可检查的结果</h2><p>读完一条路线，留下一张结构图、一份能复现的记录，或一个可以改变参数的小实验。阅读进度只是路标，结果才方便自己日后验证。</p><a class="btn ghost" href="/lab/">打开机器人实验室 ↗</a></div>
