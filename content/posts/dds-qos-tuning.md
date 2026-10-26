---
title: DDS 选型与调参：从 QoS 到零拷贝
slug: dds-qos-tuning
date: 2026-04-12
updated: 2026-10-02
tags: [DDS, 中间件, 系统工程]
summary: 从消息语义出发选择 QoS，区分进程内通信、共享内存和零拷贝，并用可复现的测量定位 DDS 延迟与抖动。
cover: assets/uploads/o5g367-o5g367-7c1a3f136a.webp
featured: true
draft: false
archived: false
---

机器人通信首先要回答三个问题：这条消息过期后还有没有价值，丢失后是否需要补发，接收端多久收不到数据就必须改变行为。QoS 的选择应当从这些问题出发。

本文以 ROS 2 中的 DDS 通信为背景。实现、RMW、消息类型和版本会影响实际路径；同一组配置不能保证在所有平台上得到相同延迟。

## 先画出消息经过的路径

```text
采样 → 应用发布 → 中间件缓存 → 传输 → 接收缓存 → 执行器调度 → 控制计算
```

通信慢不一定是网络慢。序列化、消息复制、资源不足、线程唤醒和回调排队，都可能让数据在使用时已经过期。先测出时间花在哪里，再调整传输或调度。

| 测量点 | 要回答的问题 | 一起记录的字段 |
|---|---|---|
| 采样到发布 | 驱动或上游处理是否积压 | 采样时间、序号 |
| 发布到接收 | 传输与缓存是否有长尾 | 消息大小、QoS、丢失序号 |
| 接收到回调 | 执行器是否被其他任务阻塞 | 回调起止时间、线程 |
| 采样到控制使用 | 控制器真正拿到多旧的数据 | 数据年龄、拒收原因 |

跨设备时间戳相减需要时钟同步与误差说明；不能把两台机器各自的单调时钟直接相减。

## QoS 先保证匹配，再讨论取舍

订阅者请求的可靠性不能高于发布者提供的可靠性。例如，`BEST_EFFORT` 发布者无法满足 `RELIABLE` 订阅者；反向组合可以匹配。其他参与匹配的策略也必须兼容。完整规则见 [ROS 2 QoS 文档](https://docs.ros.org/en/humble/Concepts/Intermediate/About-Quality-of-Service-Settings.html)。

```bash
# 在已经配置 ROS 2 环境的终端里，检查两端实际生效的配置
ros2 topic info /joint_states --verbose
```

如果话题存在却没有数据，先核对类型、Domain ID、发现范围与 QoS，不要立即归因于丢包。

## 不同消息，需要不同的交付语义

| 消息 | 可评估的起点 | 应用层仍需处理 |
|---|---|---|
| 周期传感器流 | BEST_EFFORT、较浅 KEEP_LAST、VOLATILE | 时间戳、丢帧统计、数据过期 |
| 周期控制参考 | 按失包容忍度比较 BEST_EFFORT 与 RELIABLE | 序号、有效期、超时降级 |
| 配置快照 | RELIABLE；需要晚加入者拿到快照时使用 TRANSIENT_LOCAL | 版本号、校验、原子切换 |
| 一次性模式切换 | 带请求编号和结果确认的服务或协议 | 幂等、拒绝原因、超时状态 |
| 高频图像或点云 | 按处理吞吐选择队列和可靠性 | 丢弃策略、缓冲区所有权 |

`KEEP_LAST(1)` 限制历史缓存深度，不会自动清理应用自己排队的数据。`DEADLINE` 可以报告期望更新周期未满足，不能代替控制器的看门狗。`TRANSIENT_LOCAL` 适合保留状态快照，不应无条件用于一次性运动命令，以免晚加入的节点收到不适合重放的旧命令。

下面是 ROS 2 C++ 的 QoS 构造片段，需要放进已有节点并包含 `rclcpp` 头文件；它不是一份独立可执行程序。

```cpp
auto sensor_qos = rclcpp::QoS(rclcpp::KeepLast(1))
    .best_effort()
    .durability_volatile();

auto config_qos = rclcpp::QoS(rclcpp::KeepLast(1))
    .reliable()
    .transient_local();
```

### 小实验：消息到了，为什么还是旧的？

把发送频率固定为 **20 Hz**、处理频率固定为 **8 Hz**，观察 **数据年龄 = 处理时刻 − 采样时刻**。下面只模拟一个应用接收队列：满时丢弃最旧消息，消费时取队首；容量 1 与容量 8 的区别，可以帮助理解缓存深度的取舍。

它不是 DDS 实现仿真，不模拟发现、重传或真实线程调度，也不把队列淘汰等同于网络丢包。先比较两种容量，再增加传输时间，看看数据年龄与队列淘汰数如何变化。

```js run
demo.root.innerHTML = `
<style>.queue-demo{font:13px/1.5 system-ui}.queue-demo canvas{width:100%;height:auto;background:#0c1624;border-radius:12px}.queue-fields{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:10px 0}.queue-fields label{flex:1;min-width:145px;display:grid;gap:4px}.queue-fields input,.queue-fields select{width:100%}.queue-actions{display:flex;gap:7px;flex-wrap:wrap}.queue-stats{display:flex;gap:12px;flex-wrap:wrap;margin:8px 0;font-size:12px}.queue-status{min-height:36px;font-size:12px;margin:6px 0}</style>
<section class="queue-demo" aria-label="消息队列与数据年龄实验">
 <canvas id="queue-canvas" width="640" height="190" role="img" aria-label="消息从发送到队列再到处理端的动画，下方曲线为已处理消息的数据年龄"></canvas>
 <div class="queue-fields"><label>接收队列容量<select id="queue-depth" aria-label="接收队列容量"><option value="1">1 条 · 只留最新</option><option value="8">8 条 · 缓冲更多</option></select></label><label>固定传输时间 <output id="queue-delay-value"></output><input id="queue-delay" aria-label="固定传输时间，毫秒" type="range" min="0" max="250" step="10" value="40"></label></div>
 <div class="queue-actions"><button id="queue-start" type="button">开始</button><button id="queue-pause" type="button" disabled>暂停</button><button id="queue-reset" type="button">重置参数</button></div>
 <div class="queue-stats"><span>已处理 <output id="queue-consumed">0</output></span><span>队列淘汰 <output id="queue-dropped">0</output></span><span>平均数据年龄 <output id="queue-age">—</output></span></div>
 <p id="queue-status" class="queue-status" role="status" aria-live="polite">修改容量或传输时间后重新开始，比较相同 8 秒内的数据。滑块支持方向键与触屏。</p>
</section>`;
const queueNode=id=>demo.root.querySelector('#queue-'+id);
const queueCanvas=queueNode('canvas'), queuePaint=queueCanvas.getContext('2d');
function newQueue(){return {steps:0,time:0,pending:0,nextPublish:0,nextConsume:0,created:0,consumed:0,dropped:0,ageTotal:0,lastAge:null,inflight:[],buffer:[],trace:[],mode:'ready'};}
function queueParameters(){return {depth:Number(queueNode('depth').value)===8?8:1,delay:Number(queueNode('delay').value)/1000};}
function stepQueue(s,p){
 if(s.mode!=='running')return;
 s.steps+=1;s.time=s.steps*0.005;
 while(s.nextPublish<=s.time+1e-9){
  const created=s.nextPublish;s.inflight.push({id:++s.created,created,arrival:created+p.delay});s.nextPublish=s.created/20;
 }
 while(s.inflight.length&&s.inflight[0].arrival<=s.time+1e-9){
  const message=s.inflight.shift();
  if(s.buffer.length>=p.depth){s.buffer.shift();s.dropped+=1;}
  s.buffer.push(message);
 }
 while(s.nextConsume<=s.time+1e-9){
  const time=s.nextConsume;s.nextConsume+=1/8;
  if(s.buffer.length&&s.buffer[0].arrival<=time+1e-9){
   const message=s.buffer.shift(),age=Math.max(0,time-message.created);
   s.consumed+=1;s.ageTotal+=age;s.lastAge=age;s.trace.push({t:time,age});
  }
 }
 if(s.steps>=1600)s.mode='done';
}
let queue=newQueue();
function drawQueue(){
 const g=queuePaint,p=queueParameters(),px=t=>45+t/8*569,py=age=>162-age/0.7*72;
 g.clearRect(0,0,640,190);g.font='11px system-ui';g.fillStyle='#bacada';
 g.fillText('发送 20 Hz',16,18);g.fillText('传输 '+Math.round(p.delay*1000)+' ms',115,18);g.fillText('队列 '+queue.buffer.length+' / '+p.depth,289,18);g.fillText('处理 8 Hz',542,18);
 g.strokeStyle='#354e61';g.lineWidth=2;g.beginPath();g.moveTo(55,42);g.lineTo(570,42);g.stroke();
 g.fillStyle='#6de0c4';g.fillRect(24,30,45,25);g.fillStyle='#cba5ed';g.fillRect(552,30,45,25);
 for(const message of queue.inflight){const progress=p.delay?Math.max(0,Math.min(1,(queue.time-message.created)/p.delay)):1;g.fillStyle='#e5c680';g.beginPath();g.arc(90+progress*166,42,4,0,Math.PI*2);g.fill();}
 for(let i=0;i<p.depth;i++){g.fillStyle=i<queue.buffer.length?'#5cc3ae':'#1c3041';g.fillRect(274+i*28,31,23,22);}
 g.fillStyle='#b6c8da';g.fillText('数据年龄 / ms',14,78);g.fillText('0',43,182);g.fillText('4',325,182);g.fillText('8 s',595,182);
 g.lineWidth=1;for(const age of [0,0.2,0.4,0.6]){g.strokeStyle='#243a4d';g.beginPath();g.moveTo(45,py(age));g.lineTo(614,py(age));g.stroke();g.fillText(String(Math.round(age*1000)),12,py(age)+4);}
 g.strokeStyle='#6de0c4';g.lineWidth=2;g.beginPath();queue.trace.forEach((s,i)=>{i?g.lineTo(px(s.t),py(s.age)):g.moveTo(px(s.t),py(s.age));});g.stroke();
 queueNode('delay-value').textContent=Math.round(p.delay*1000)+' ms';queueNode('consumed').textContent=String(queue.consumed);queueNode('dropped').textContent=String(queue.dropped);
 queueNode('age').textContent=queue.consumed?(queue.ageTotal/queue.consumed*1000).toFixed(0)+' ms':'—';
 queueNode('pause').disabled=queue.mode!=='running';queueNode('start').disabled=queue.mode==='running';queueNode('start').textContent=queue.mode==='paused'?'继续':'开始';
}
const queueLoop=demo.animate(({delta})=>{
 queue.pending+=delta;const p=queueParameters();while(queue.pending+1e-12>=0.005&&queue.mode==='running'){queue.pending-=0.005;stepQueue(queue,p);}drawQueue();
 if(queue.mode==='done'){queueNode('status').textContent='8 秒完成。较大缓存可能保留更多旧消息；容量 1 优先新鲜度，但会淘汰尚未消费的消息。';return false;}
});
function resetQueue(defaults){queueLoop.reset();if(defaults){queueNode('depth').value='1';queueNode('delay').value='40';}queue=newQueue();drawQueue();queueNode('status').textContent='已准备新实验。传输时间只影响到达时刻，处理端仍每 125 ms 取一条。';}
queueNode('start').onclick=()=>{if(queue.mode==='done')resetQueue(false);queue.mode='running';drawQueue();queueNode('status').textContent='观察黄点的传输、接收缓存与下方的数据年龄曲线。';queueLoop.start();};
queueNode('pause').onclick=()=>{if(queue.mode!=='running')return;queueLoop.pause();queue.mode='paused';drawQueue();queueNode('status').textContent='已暂停；再次开始会保留队列，从当前时刻继续。';};
queueNode('reset').onclick=()=>resetQueue(true);queueNode('depth').onchange=queueNode('delay').oninput=()=>resetQueue(false);drawQueue();
```

如果把这个数据年龄带进控制回路，还会改变什么？[机器人实验室的延迟关](/lab/#把控制环调稳) 可以接着观察反馈落后时的响应。

## 三种优化，别混为一谈

**进程内通信**处理同一进程中节点之间的数据传递。是否减少复制，还与发布方式、订阅者数量和消息所有权有关。

**共享内存传输**处理同机进程间的数据通路。传输绕过 socket，并不等于应用到订阅回调的每一层都不复制。

**借用消息与零拷贝**要求中间件、类型和调用路径共同支持，还需要管理样本归还与生命周期。启用一个开关后，应通过跟踪、性能数据或实现提供的诊断确认路径，不能只看“配置加载成功”。

因此，先把普通传输测稳定，再逐项切换。不要用同进程结果与跨机结果作直接的“优化前后”对照。

## 一份能复现的压测记录

每次只改变一个变量，保留以下信息：

- CPU、系统与内核版本、ROS 2 / RMW / DDS 版本。
- 同进程、同机跨进程或跨机拓扑，以及网卡和链路条件。
- 消息类型、大小、频率、发布者与订阅者数量。
- 暖机时间、采样时长、后台负载与时钟同步方法。
- p50、p95、p99、观测最大值、丢失率、超期率与 CPU 占用。

下面的 **Python 3 独立示例**只说明统计方法，输入是教学数据，不是本站机器人的实测结果。

```python
import math

def summarize_us(samples, deadline_us):
    values = sorted(samples)
    if not values or not math.isfinite(deadline_us) or deadline_us <= 0:
        raise ValueError('需要非空样本和正的截止时间')
    if any(not math.isfinite(v) or v < 0 for v in values):
        raise ValueError('延迟必须是有限的非负值')
    p99 = values[math.ceil(0.99 * len(values)) - 1]
    return {
        'count': len(values),
        'p99_us': p99,
        'max_us': values[-1],
        'late_ratio': sum(v > deadline_us for v in values) / len(values),
    }

print(summarize_us([80, 90, 100, 110, 1400], 1000))
```

五个样本的 p99 实际上就是最大值，不能支撑稳定的尾延迟结论。正式比较需要更长时间和多轮重复测试。

## 发现与启动也要单独测试

固定拓扑可以评估静态对端或受控的发现机制，但配置项及其作用取决于 DDS 实现。关闭组播不等于只配置对端地址；网卡选择、参与者端口、防火墙与重启行为都需要核对。

分别测“冷启动到首次匹配”“节点重启后的恢复时间”和“稳定运行时的数据年龄”。它们是三个问题，不应只给出一个平均延迟。

## 调整顺序

先确认两端匹配，再检查数据过期与回调积压，然后评估队列、可靠性和传输路径，最后结合 CPU 与执行器调度优化。每一步都保留能够回退的配置和相同条件下的测量。

继续阅读：[控制回路的实时性](/posts/realtime-control-loop/) · [中间件项目记录](/projects/joysonrobot_comm/)。
