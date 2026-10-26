---
title: cordis-cpp
slug: cordis-cpp
tagline: C++20 元框架：让插件的装卸与热替换在运行时结构安全
date: 2026-09-28
tags: [C++, 架构, 运行时]
stack: [C++20, CMake, nlohmann/json]
status: 开发中
links:
  - { label: GitHub, href: "https://github.com/luoyebai/cordis-cpp" }
cover: assets/bg/comet.jpg
featured: true
order: 1
updated: 2026-09-30
summary: 把「可回滚的副作用」与「响应式 coeffect」做成运行时机制，据此实现插件的运行时装入、卸载、依赖解析与配置热重载。
---

项目目标是把**动态组合**变成结构上安全的事：组件可以在运行时装入、卸载与热替换，而卸载之后它对共享环境做过的改动必须干净地退回去。做法不是靠调用约定，而是把两个经典的编程语言概念提成运行时机制：

| 维度 | 机制 | C++ 里的写法 |
|---|---|---|
| 时间 | 可回滚副作用（一个变换加它的左逆，按 LIFO 记录并回放） | `ctx.effect([]{ …; return []{ /* 撤销 */ }; })` |
| 空间 | 响应式 coeffect（声明依赖，依赖出现或消失时自动响应） | `ctx.provide<T>(…)` / `ctx.use<T>()` + 插件的 `inject` |

思路来自论文 *A Programming Paradigm for Spatiotemporal Composability*，实现参照 [cordiverse/cordis](https://github.com/cordiverse/cordis)。

## 核心抽象

```text
Context            统一句柄：副作用累加器 + 依赖作用域
 ├─ Fiber          插件实例；记录副作用、驱动生命周期状态机
 ├─ ServiceRegistry  响应式 coeffect 解析 + 反向依赖索引
 ├─ EventsService    全局事件总线（on / once / emit / serial / bail / parallel）
 ├─ RegistryService  把 Plugin 声明变成 fiber
 ├─ Tracer         时间线 + 副作用树（轨迹追踪）
 └─ Loader        （独立库）声明式配置对账 + 热重载
```

## Fiber 的生命周期

fiber 创建时是 `Pending`，运行时会拿它声明的 `inject` 键去当前上下文里解析：

- 依赖齐全 → `load()`（跑函数体、收集副作用）→ `Active`
- 任一依赖消失 → `unload()`（按 **LIFO** 回放 disposer、摘掉自己提供的服务）→ `Pending`
- 函数体抛异常 → `Failed`，已经产生的副作用会被回滚

这就是响应式 coeffect 的循环：**声明依赖，而不是去查询依赖**。依赖的出现和消失都会让组件自动进出场，调用方不需要写「如果服务在就先启动」这类判断。副作用按 LIFO 回放则是可回滚性的保证；依赖图必须无环。

事件监听器挂在共享总线上，**注册本身就是副作用**，所以其所属 fiber 卸载时监听器会一起消失，不会留下悬空回调。

## 声明式加载器与热重载

`libcordis_loader.a` 用 JSON 描述要跑哪些插件，把运行中的集合与配置对账：按依赖顺序增删和更新模块，激活仍然由运行时的 coeffect 驱动。

```cpp
Loader loader(ctx);
loader.registerModule("db", {}, {},
  [](Context& c, const Json&) { c.provide<DB>(std::make_shared<DB>(c, "db")); });
loader.registerModule("api", {"db"}, {ServiceKey::of<DB>()},
  [](Context& c, const Json&) { c.effect([]{ /* 上线 */ return []{ /* 下线 */ }; }); });

loader.applyJson(R"({"plugins": {"db": true, "api": true}})");
```

配置写的 `requires`（模块名）只决定加载顺序，真正驱动生命周期的是服务 `inject`，所以激活是响应式的而不是命令式的。配合 `FileWatcher` 监听配置文件，改动后重新对账即可，不必重启进程。

## 轨迹追踪

运行时记录两套可以导出为 JSON 的轨迹：**结构轨迹**是副作用树（每个副作用带标签，在另一个副作用体内创建的副作用会挂在它下面），**时间轨迹**是内部事件（`internal/plugin`、`internal/status`、`internal/service`、`internal/dispatch`）组成的有序时间线，由 `Tracer` 订阅。这是回放和排查「卸载之后到底留下了什么」的依据。

## 构建与验证

需要 CMake ≥ 3.20、支持 C++20 的编译器（GCC ≥ 11 或 Clang ≥ 14），以及 nlohmann/json ≥ 3.2（系统里没有就自动拉取）。产出两个静态库：`libcordis_core.a` 是运行时（副作用、coeffect、fiber、事件、插件），`libcordis_loader.a` 是加载器。

```bash
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build
ctest --test-dir build --output-on-failure
```

仓库里的测试是**不依赖第三方测试框架**的自带测试集，覆盖运行时、追踪与加载器三块；`examples/` 下有两个可以直接跑的演示（核心运行时、加载器 + 配置热重载）。

## 与参考实现的差异

- **副作用是同步的。** cordis 支持异步 disposer（Promise / AsyncIterable），这里只跟踪 `std::function<void()>`，异步事件与异步副作用留作后续扩展（C++20 协程）。
- **服务按类型索引。** cordis 用名字字符串，这里的 `ServiceKey` 可以是 `std::type_index` 或显式名字，`use<T>()` 因此是类型安全的。
- **配置用 `nlohmann::json` 而不是 `std::any`。** JSON 可检查、可比较（热重载靠 `==` 就能判断有没有变），只在类型已知的边界上转换一次。`std::any` 只留在事件载荷这种真正异构的地方。
- **保留项**：`isolate` / `intercept` 在 v1 里只是元数据，隔离可见性、`waterfall` 中间件、异步副作用都还没实现。

仓库：<https://github.com/luoyebai/cordis-cpp>（MIT 许可）。上面写的构建步骤与模块划分来自项目 README，本页没有把示例代码等同于已经完成的规模验证。
