---
title: 小型人形机器人 0→1：从 URDF 到真机部署的工具链
slug: humanoid-0-to-1-toolchain
date: 2026-02-14
tags: [人形, 工具链, DDS, 仿真]
summary: 把一台小型人形机器人从结构图纸做到能跑策略，中间要过的每一道工具：URDF 导出后怎么查零件与关节、用 IDL + Fast DDS 设计通讯 SDK、怎么在 MuJoCo 里提前验证算法所需的硬件频率与鲁棒性、真机后台的分层架构，以及仿真到真机不改代码的部署方式。
cover: assets/uploads/3l17mv-3l17mv-e9cda3a5fa.webp
featured: false
draft: false
archived: false
---

::: note 迁移说明
SDK 源码不随本文转载，后台架构一节只保留目录结构与设计意图；飞书内网链接已移除。
:::

## 小型人形机器人研发0到1方案介绍

内容包括：小机器人URDF导出展示、通讯SDK、Mujoco仿真、部署调试代码、调试客户端等工具展示。

制作机器人的整体流程如下：

小机器人所用的工具在流程的各阶段均有涉及。

### 小机器人导出URDF展示

在机器人的结构设计完成后（通常在结构设计前还需要进行关节电机、传感器选型和硬件架构设计等），需要导出URDF（Universal Robot Description Format）是一种用于描述机器人模型（如连杆、关节、运动学参数、可视化模型等）的XML 文件格式。

https://wiki.ros.org/urdf

- 在结构导出为URDF后，我们需要检查各个部分的质心、惯量、碰撞等属性，以确保该文件的准确性。

我们可以使用以下网站进行检查：https://viewer.robotsfan.com/

- URDF 导出及检查详细请参考：

#### 零件检查

确保

- 零件完整性检查：没有零件缺失、错位、错误的情况

- 零件惯量检查：确保惯量的数值与实际一致

- 零件质心检查：确保零件的质心正确

![图片.png](/assets/feishu/humanoid-0-to-1-toolchain/fig-01.webp) ![图片.png](/assets/feishu/humanoid-0-to-1-toolchain/fig-02.webp) ![图片.png](/assets/feishu/humanoid-0-to-1-toolchain/fig-03.webp)

#### 关节检查

确保

- 坐标轴一致：关节的坐标轴一致，均为右手坐标系

- 旋转轴一致：关节旋转轴统一指向坐标轴正方向

- 限位检查：保证限位符合实际要求（如：机械结构限位、电气软件限位等）

![图片.png](/assets/feishu/humanoid-0-to-1-toolchain/fig-04.webp)

![图片.png](/assets/feishu/humanoid-0-to-1-toolchain/fig-05.webp)![图片.png](/assets/feishu/humanoid-0-to-1-toolchain/fig-06.webp)![图片.png](/assets/feishu/humanoid-0-to-1-toolchain/fig-07.webp)

---

### 小机器人通讯SDK

#### 小机器人通讯中间件

小机器人通讯sdk使用fastdds作为通讯中间件，IDL（Interface description language）作为统一的接口管理。

https://github.com/eProsima/Fast-DDS

在编写相关sdk时，需要先确定IDL的内容，如

```bash
idl
├── BmsState.idl
├── ButtonEventType.idl
├── ImuState.idl
├── LowCmd.idl
├── LowState.idl
├── MotorCmd.idl
├── MotorState.idl
├── RpcReqMsg.idl
└── RpcRespMsg.idl
```

其中，BmsState为电池信息、ButtonEventType为遥控按钮信息、ImuState为IMU信息、MotorCmd为发送给关节电机的信息、MotorState为关节电机返回的信息、LowCmd整合了可以发送的底层信息、LowState整合了接收到的所有底层状态信息、RpcReqMsg和RpcRespMsg用于实现RPC的数据包装。

#### 小机器人SDK封装

通过fastddsgen，将idl生成为对应的C++代码。

https://github.com/eProsima/Fast-DDS-Gen

通过以上方式，再加上具体对fastdds的通讯实现，即可封装cpp相关的sdk代码。

为了方便使用，还需将其绑定到python实现。

使用pybind11作为python封装接口：

https://github.com/pybind/pybind11

通过自定义stg文件可以做到自动生成idl对应的pybind11封装：

![image.png](/assets/feishu/humanoid-0-to-1-toolchain/fig-08.webp)

以LRLowStateSubscriber为例：

```cpp
// 具体实现
class __attribute__((visibility("hidden"))) LRLowStateSubscriber
    : public std::enable_shared_from_this<LRLowStateSubscriber> {
   public:
    explicit LRLowStateSubscriber(const py::function& py_handler) : py_handler_(py_handler) {}
    void InitChannel() {
      // ......
    }
    void CloseChannel() {
      // ......
    }
   private:
      // ......
};

// 绑定到python
py::class_<robot::little_robot::LRLowStateSubscriber, std::shared_ptr<robot::little_robot::LRLowStateSubscriber>>(
    m, "LRLowStateSubscriber")
    .def(py::init<const py::function&>(), py::arg("handler"), R"pbdoc(
            // ...注释
        )pbdoc")
    .def("InitChannel", &robot::little_robot::LRLowStateSubscriber::InitChannel, "Init low state subscription channel")
    .def("CloseChannel", &robot::little_robot::LRLowStateSubscriber::CloseChannel,
         "Close low state subscription channel");
```

将其安装到系统即可使用相关python sdk，这是小机器人封装sdk的方式，也可以直接通过python相关的dds通讯直接实现python sdk。

然后就可以通过sdk编写一些程序来进行可视化/调试。详细见1.6小节。

---

### 小机器人Mujoco仿真

使用uniree_mujoco作为模板，将unitree_sdk2切换到小机器人所使用的sdk。

https://github.com/unitreerobotics/unitree_mujoco

并添加了能单独设置硬件更新频率的配置：

```yaml
dds_hz: 500 # 以 500hz 发送仿真状态数据
imu_hz: 400 # 以 400hz 更新IMU数据
motor_hz: 500 # 以 500hz 更新/控制电机
```

#### URDF导出为MJCF

通过mujoco程序compile导出为mjcf

```bash
<MUJOCO_INSTALL_PATH>/compile
 Usage:  compile infile outfile
   infile can be in mjcf, urdf, mjb format
   outfile can be in mjcf, mjb, txt format
 Example: compile model.xml model.mjb
```

其格式如下：

https://mujoco.readthedocs.io/en/stable/XMLreference.html

如果需要加载地形，可通过unitree_mujoco中工具进行地形生成

https://github.com/unitreerobotics/unitree_mujoco/tree/main/terrain_tool

包括浮空楼梯、楼梯、斜坡、圆柱台阶、碎石地面、粗糙地面、用图片生成的地面几类

![图片.png](/assets/feishu/humanoid-0-to-1-toolchain/fig-09.webp)

#### 提前验证

1. 提前验证算法所需硬件频率及性能

    实机通讯频率未知的情况下，可以通过提前通过设置硬件频率来验证算法所需硬件频率。

    如imu设置为 50hz（左）与 45hz（右） 的情况

2. 提前验证算法鲁棒性

通过部署代码（与真机代码类似）直接和mujoco进行通讯，通过完全异步的控制方案来验证算法。

![仿真里跑部署代码：完全异步的控制回路](/assets/feishu/humanoid-0-to-1-toolchain/video-01.mp4)

此时应当检查电机参数是否合理，如仿真中关节力矩持续超过电机额定力矩，这会电机导致过热无法长时间运行。

- 若存在电机完全无法满足要求的情况，需要进行重新硬件选型。

- 若算法存在完全无法使用该结构设计的情况，需要重新进行结构设计或更换算法方案。

---

### 小机器人真机后台程序

后台程序是整台机器人上最繁琐的一块：它要同时管硬件读写、通讯、日志、看门狗、
服务管理和对外接口。要让它可维护，唯一的办法是**分层**，并且让每一层只知道自己那一层的事。

小机器人采用的目录结构（`include/` 放头文件，实现在 `src/`）：

```text
include
├── common                       // 通用工具，与具体机器人无关
│   ├── dds/                     // DDS 通讯封装
│   ├── robotlog/                // 日志管理
│   ├── serial.hpp               // 串口通讯
│   ├── can_utils.hpp            // CAN 通讯
│   └── time/
│       ├── fps_counter.hpp      // 帧率与丢包率统计
│       └── high_timer.hpp       // 高精度定时器
├── component                    // 硬件相关
│   ├── hal_interface/           // HAL 接口定义（纯虚基类 + 错误码）
│   │   ├── common.hpp           // 错误码、CRC 等通用功能
│   │   ├── ibms.hpp  idcu.hpp  iimu.hpp  imotor.hpp
│   └── hal_impl/                // HAL 实现，一种硬件一个实现
│       ├── bms/                 //   电池
│       ├── dcu/                 //   驱动控制单元（含 USB 转 CAN）
│       └── imu/                 //   惯性测量单元
├── idl                          // 通讯数据类型（由 .idl 生成）
│   ├── little_robot/
│   └── rpc/                     // RpcReqMsg / RpcRespMsg
└── robot                        // 机器人本体相关
    ├── channel/                 // 发布者 / 订阅者 / 通道工厂
    ├── common/                  // 状态机、通用参数、类型转换
    ├── little_robot/            // 常量、API 定义、脚踝并联解算、客户端封装
    └── rpc/                     // RPC 客户端与服务端实现
```

加上进程与系统配置：

```text
daemons
├── daemon.hpp                       // 通用后台封装（看门狗 + SocketServer + 崩溃处理）
├── daemon_test.cpp
├── robot_lr_daemon_lowctrl.cpp      // 底层控制主程序
├── robot_lr_daemon_lowctrl.hpp
├── robot_lr_daemon_lowctrl_config.hpp
└── robot_lr_daemon_lowctrl_server.hpp   // 对外的 RPC 服务端

config
├── daemons/
│   ├── robot_lowctrl.service        // systemd 单元
│   └── robot_lr_daemon_lowctrl.json // 运行参数
└── rules/
    ├── usb_can.rules                // udev 规则：固定设备名
    └── usb_to_4ttl.rules
```

#### 四层各自负责什么

**通用层（common）。** 与机器人无关的工具，换一台机器人可以直接搬走。

- **日志**：封装 spdlog，异步写、按大小轮转、限制总量，避免长时间运行把磁盘写满。
  日志目录固定（`/var/log/robot/`），轮转交给日志库自己管，不要指望 systemd。
- **高精度定时器**：用 `timerfd_create` 而不是 `sleep` 做周期触发。
  `sleep_for` 只保证「至少睡这么久」，误差会累积；`timerfd` 由内核维护绝对到期时刻，
  不会漂移。控制回路里这个差别是决定性的。
- **帧率/丢包统计**：每个硬件采集线程调一次 `Tick()`，失败时调 `TickLost()`，
  定期把统计写进日志。**丢包率是这类系统最重要的一个健康指标** ——
  电机通讯丢一帧，力矩就少发一帧，表现出来是关节抖动，而不是报错。
- **物理层通讯**：分两种情况 —— 厂商给了 Linux SDK 的（如 USB 转 CAN 模块）直接引；
  需要自己搓的（CAN 电机）就封装成统一接口。这一层封装一次，同协议的硬件以后都能复用。

**硬件抽象层（component）。** 这一层是整个架构里回报最高的地方。

思路很简单：为每类硬件定义一个纯接口（`ibms` / `iimu` / `idcu` / `imotor`），
硬件相关的代码只实现接口，上层只认接口。换电机、换 IMU 时只动 `hal_impl/` 下的一个文件。

有两个细节值得单独说：

- **HAL 传递的数据类型要是「平凡类型」**（trivial type，即可以 `memcpy` 的类型）。
  原因是这些数据之后要通过 DDS 传出去，平凡类型才能用原子操作做无锁读写，
  否则每次上报都得加锁，500 Hz 下锁竞争会成为瓶颈。
- **接口要按「能力」而不是「型号」设计**。比如不是所有电机都支持 PD 控制，
  如果接口里写了 `SetPD()`，遇到不支持的电机就只能返回失败或者假装成功。
  更稳妥的做法是把这类能力做成接口的一部分（如 `SupportsPD()`），
  让上层能真的分支处理，而不是靠约定。

**机器人通讯层（robot）。** DDS 数据面 + RPC 控制面。

- **状态机**用「注册表 + 回调」实现，而不是一大堆 `if/else`：
  定义每个状态允许跳到哪里，切换时回调注册的函数。

  ```cpp
  using ChangeStatePath = std::unordered_map<int, std::string>;
  static const ChangeStatePath DAMPING_PATH = {DAMPING_STATE, PREPARE_STATE, CUSTOM_STATE};
  static const ChangeStatePath PREPARE_PATH = {DAMPING_STATE, PREPARE_STATE, WALKING_STATE};
  static const ChangeStatePath WALKING_PATH = {DAMPING_STATE, PREPARE_STATE, WALKING_STATE};
  static const ChangeStatePath CUSTOM_PATH  = {DAMPING_STATE, PREPARE_STATE, CUSTOM_STATE};
  ```

  这样「阻尼 → 行走」这种非法跳转会被表本身挡住，不需要在每个入口函数里写检查。
  四款主流小型人形机器人的状态机都是这个形状：零力矩 / 阻尼 / 站立准备 / 行走 / 特殊模式。

- **常量参数**（关节数、关节顺序、话题名）集中在一个头文件里。
  更好的做法是直接从 URDF 生成 —— 结构改了不用改两处。
- **脚踝并联解算**放在这一层，因为它是「关节角 ↔ 末端位姿」的映射，属于本体知识。
- **API 层**：对外的通道、话题、服务 ID 和给二次开发的客户端封装都收在这里。

**RPC。** 用 DDS 自己实现 RPC，而不是引入 gRPC：DDS 已经在跑，再加一套 gRPC
就多一份依赖和一套序列化。请求与响应都用 IDL 定义、数据体是 JSON，
服务端靠请求头里的 UUID 匹配响应。

```cpp
const int64_t RpcStatusCodeSuccess = 0;
const int64_t RpcStatusCodeTimeout = 100;                 // 请求超时
const int64_t RpcStatusCodeBadRequest = 400;              // 参数非法
const int64_t RpcStatusCodeInternalServerError = 500;     // 服务端内部错误
const int64_t RpcStatusCodeServerRefused = 501;           // 服务端拒绝
const int64_t RpcStatusCodeStateTransitionFailed = 502;   // 状态机不允许这次跳转
const int64_t RpcStatusCodeInvalid = -1;                  // 尚未发送
```

注意 `502` 这一条：**把「状态机不允许」单独做成一个错误码**，
调用方才能区分「我发错了」和「现在时机不对」。很多系统把这类失败都归到 400，
上层只能靠重试碰运气。

局限也很清楚：DDS 的 RPC 走不出局域网，做不了网络穿透。
真要做远程控制得上 gRPC 或 WebRTC —— 所以**现在就把 RPC 的边界划清楚**，
将来换实现只动这一层。

**后台执行层（daemons）。** 把上面四层拼成一个能长期无人值守运行的进程。

- **崩溃处理**：注册信号处理器，把调用栈写进日志文件再退出。
  机器人现场出问题时，事后唯一能指望的就是这份 crash log。
- **软看门狗**：任务抛异常时把 `task_running_` 置为 false，
  看门狗线程每秒检查一次，发现为 false 就重新初始化该任务。核心逻辑就这几行：

  ```cpp
  void Watchdog() {
      while (wd_running_.load()) {
          if (task_running_.exchange(true) == false) {
              ROBOT_INFO("[Watchdog] Daemon stopped, restarting.");
              failed_count_.store(0);
          }
          std::this_thread::sleep_for(std::chrono::seconds(1));
      }
  }
  ```

  为什么是**软**看门狗：它救不了进程整体挂死（那要靠 systemd 的 `Restart=always`），
  但能救「某个任务抛了异常、线程退了」这种局部故障 —— 后者更常见，
  而且进程还活着，systemd 看不见。
- **本机 SocketServer**：在本地 Unix socket 上收字符串命令，
  用来在不重启进程的前提下暂停/恢复底层控制、重新加载配置。
  用 Unix domain socket 而不是 TCP：不占端口、天然只能本机访问、权限由文件系统管。

- **systemd 单元**把「开机自启 + 崩溃重启 + 实时调度 + CPU 亲和」一次性配好：

  ```ini
  [Service]
  ExecStart=/usr/local/bin/robot_lr_daemon_lowctrl
  Restart=always
  RestartSec=5s
  StartLimitIntervalSec=60       # 60 秒窗口内
  StartLimitBurst=5              # 崩超过 5 次就停止重启，避免疯狂重启刷满日志

  CPUAccounting=yes
  CPUQuota=100%
  CPUSchedulingPolicy=fifo       # 实时调度
  CPUSchedulingPriority=80
  CPUAffinity=2 3                # 绑核，把控制线程和系统任务隔开
  ```

  `CPUAffinity` 和 SCHED_FIFO 是控制回路能不能跑满的前提：
  控制线程被调度到正在跑 `apt` 的核上，周期就保不住。
  `StartLimitBurst` 也别省 —— 没有它，一个必崩的配置会让日志刷到把磁盘写满。

- **udev 规则**给硬件固定设备名。USB 转 CAN 模块插上去可能是 `/dev/ttyACM0`，
  也可能是 `/dev/ttyACM1`，重新插拔还会换。按序列号绑定到固定名字：

  ```text
  KERNEL=="ttyACM*", ATTRS{idVendor}=="1483", ATTRS{idProduct}=="1110", ATTRS{serial}=="2061316C4D4D", MODE:="0666", SYMLINK+="USB2CAN0"
  KERNEL=="ttyACM*", ATTRS{idVendor}=="1483", ATTRS{idProduct}=="1110", ATTRS{serial}=="2073316C4D4D", MODE:="0666", SYMLINK+="USB2CAN1"
  ```

  这行规则看着不起眼，但少了它就会出现「换了一根线之后机器人不动了」
  这种要查半天的故障。

#### 这套架构的取舍

**做对了的**：

- **高模块化**。硬件控制、上层逻辑、通讯三者完全分离，
  换硬件只动 HAL 实现、换通讯只动 DDS 封装，其余代码不用碰。
- **每一层都能单独测**。HAL 可以用假硬件做单元测试，
  后台程序可以在没有实机的情况下用 MuJoCo 跑（正是前面 1.3 节的做法）。
- **技术栈是主流选择**：CMake + C++17/Python + DDS，
  招人和接手成本都低。

**相比成熟产品还缺什么**（这些缺口在真实交付里都会变成需求）：

| 缺口 | 后果 | 补法 |
|---|---|---|
| WebRTC / gRPC | 没法从公网控制，也没有实时视频回传 | 先划清 RPC 边界，之后替换实现 |
| GStreamer、RTSP | 视频只能本机看，多路视频要自己搓编码 | 引入统一媒体流接口 |
| OTA 升级 | 改一版软件要人工上机，出错没法回滚 | A/B 分区 + 版本校验，优先级最高 |
| 可观测性 | 现场只能靠日志文件事后翻 | 加状态上报与指标导出 |

其中 **OTA 是最该早做的**：一台部署在客户现场的机器人，
每改一次参数都要人跑一趟，这个成本很快会超过开发本身的成本。

### 小机器人部署调试代码

#### 部署代码

部署代码基于 booster_gym中的deploy进行修改，完全修改并添加了硬件封装、策略日志、mimic policy。

https://github.com/BoosterRobotics/booster_gym/tree/main/deploy

通过对硬件进行封装，可以兼容各个机器人sdk，详细见3.3小节。

#### 调试代码

调试代码使用streamlit作为可视化工具，能对数据自动分组进行可视化。

https://streamlit.io/

```text
streamlit run plot_policy_obs.py
```

![图片.png](/assets/feishu/humanoid-0-to-1-toolchain/fig-11.webp)

![图片.png](/assets/feishu/humanoid-0-to-1-toolchain/fig-12.webp)

---

### 小机器人客户端

基于1.2小节中的sdk，可以实现具备各种控制功能的调试客户端：

![图片.png](/assets/feishu/humanoid-0-to-1-toolchain/fig-13.webp)

或类数字孪生内容（下图基于Qt）：

![图片.png](/assets/feishu/humanoid-0-to-1-toolchain/fig-14.webp)

---

### 最终效果

因为使用同一套SDK进行通讯，所以可以无缝将仿真迁移到真机而不需要修改代码（与主流方案相同），最终效果如下：

![同一份 SDK 通讯，仿真直接切真机](/assets/feishu/humanoid-0-to-1-toolchain/video-02.mp4)

---
