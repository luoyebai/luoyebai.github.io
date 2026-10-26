---
title: C++ 工程工具链：构建、调试、依赖与代码质量
slug: cpp-toolchain
date: 2025-09-08
tags: [工具, C++, 系统工程]
summary: 把一套能长期维护的 C++ 工程该配的东西过一遍：构建系统怎么选、调试与分析工具各自回答什么问题、依赖怎么管，以及 clang-tidy 与 clang-format 两份可以直接拿去用的配置。
cover: assets/bg/paper.webp
featured: false
draft: false
archived: false
---

::: note 迁移说明
原文档大半是只有标题的空壳（gdb / rr / sanitizers / vcpkg / Conan / Lizard …），
这里按同一份提纲补齐了正文；示例工程压缩包未随导出保留。
:::

机器人项目里的 C++ 工程有个共同点：依赖一堆第三方库（DDS、Eigen、OpenCV、厂商 SDK）、
要跨 x86 与 ARM 编译、还得在实机上调试。工具链不是炫技，它直接决定
「改一行代码到看见结果」要多久。这篇按构建 → 调试 → 依赖 → 质量的顺序过一遍。

## 构建工具

### CMake

C++ 没有事实上的官方构建系统，CMake 是目前唯一能覆盖「跨平台 + 生态最全 + IDE 都认」的选择。
它不是构建工具，而是**构建系统的生成器** —— 你描述目标与依赖，它生成 Makefile 或 Ninja 文件。

一份最小但结构正确的 `CMakeLists.txt`：

```cmake
cmake_minimum_required(VERSION 3.16...3.29)

project(ModernCMakeExample
  VERSION 1.0
  LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# 不要用 CMAKE_CXX_FLAGS 全局塞编译选项，那会污染所有目标（包括第三方库）
# 正确做法是把选项挂在目标上，见下面的 target_compile_options

add_library(MyLibExample simple_lib.cpp)
target_include_directories(MyLibExample PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>)
target_compile_options(MyLibExample PRIVATE -Wall -Wextra)

add_executable(MyExample simple_example.cpp)
target_link_libraries(MyExample PRIVATE MyLibExample)
```

几条用了几年才真正体会到的规矩：

- **`target_*` 而不是全局变量**。`include_directories()` / `link_libraries()` 是目录级作用域，
  会顺带影响同一目录下所有目标；`target_link_libraries()` 带 `PUBLIC` / `PRIVATE` / `INTERFACE`
  关键字，才能正确地把依赖传递下去。选错关键字的表现是：本地能编，
  下游一 `find_package` 就报一堆找不到头文件的错。
- **`PUBLIC` 与 `PRIVATE` 的区别是「有没有出现在我的头文件里」**。
  只在 `.cpp` 里用的库写 `PRIVATE`，公开头文件里 `#include` 了的写 `PUBLIC`。
- **别用 `file(GLOB ...)` 收集源文件**。新加一个 `.cpp` 不会触发 CMake 重新生成，
  你得手动重跑一次 `cmake`。CI 上尤其隐蔽 —— 本地顺手重跑过，CI 就挂。
- **`cmake --build build -j` 而不是 `make -j8`**。前者不管后端是 Make 还是 Ninja 都一样，
  换后端不用改脚本。
- **给 CN 环境准备代理或镜像**。`FetchContent` / `find_package` 拉 GitHub 超时是常态。

推荐上手路径：[CMake 官方 Tutorial](https://cmake.org/cmake/help/latest/guide/tutorial/index.html)，
配合 [Modern CMake](https://cliutils.gitlab.io/modern-cmake/)（比官方教程更贴近工程实际）。

> 现在让 *AI*  写  *CMAKE*，组织架构可能是更合适的选择 *（？）*

### Xmake

[Xmake](https://xmake.io/zh/) 用 Lua 描述构建，语法比 CMake 短得多，
自带包管理（`add_requires("eigen")` 直接拉依赖，不用手写 `FindXXX.cmake`）。
中小型项目、或者不想折腾 `find_package` 的场合很省事。

代价是生态：公司/学校已有的 CMake 工程不会为你重写，
第三方库提供的 `Config.cmake` 它还得兼容，于是往往变成两套构建并存。
**新项目可以选它，接入既有工程不建议。**

### Meson + Ninja

[Meson](https://mesonbuild.com/) 用 Python 语法，可读性最好，配置速度也最快，
背后固定用 [Ninja](https://ninja-build.org/) 执行，增量构建比 Make 快一个档次。
GNOME、Wayland、systemd 这些项目都用它。

短板同样是生态位：以 CMake 为主的机器人库（DDS 实现、厂商 SDK）
基本都是 CMake 工程，混用时得靠 `cmake` 子项目包装。

> **怎么选**：和周边代码保持一致 > 个人偏好。一个仓库里混两套构建系统，
> 让新人踩的坑比省下的时间多得多。

## 调试与分析

这一组工具经常被混着叫「调试器」，但它们回答的是完全不同的问题：

| 工具 | 回答什么问题 | 典型用途 |
|---|---|---|
| gdb / lldb | 这一时刻，程序的变量和调用栈是什么 | 崩溃现场、逻辑不符预期 |
| rr | 刚才这段执行过程里到底发生了什么 | 难以复现的竞态、只在 CI 挂的 bug |
| ASan | 有没有越界、use-after-free、内存泄漏 | 开发期常开 |
| UBSan | 有没有未定义行为 | 开发期常开 |
| TSan | 有没有数据竞争 | 多线程模块 |
| perf | 时间花在哪里 | 性能优化，先测量再改 |

### gdb / lldb

- 编译时加 `-g -O0`（或 `-Og`）。**带优化调试是自找麻烦**：
  变量被优化掉、行号对不上、单步乱跳。
- `-D_GLIBCXX_DEBUG` 打开 libstdc++ 的调试模式，越界访问 `std::vector`
  会立刻断言，而不是在几十行之后表现成莫名其妙的数值错误。
- 多线程里 `set scheduler-locking on` 才能稳定单步；不然你停在一个断点上，
  别的线程还在改内存。
- ROS 2 / DDS 程序别忘了 `ros2 run --prefix 'gdb -ex run --args'`。

### rr

[rr](https://rr-project.org/) 把一次执行**录制**下来，之后可以正着走、倒着走任意多次。
对「跑一百次只挂一次」的 bug，它是唯一现实的手段：

```bash
rr record ./my_node --args
rr replay            # 在这一步里随便回退、随便加断点
```

限制是它依赖 `perf_event_open`，容器里常被禁；部分内核需要调 `perf_event_paranoid`。

### sanitizers

加一个编译选项就能用，性价比极高，值得在 CI 里单独跑一轮：

```bash
# 地址：越界、use-after-free、泄漏
cmake -DCMAKE_BUILD_TYPE=Debug \
      -DCMAKE_CXX_FLAGS="-fsanitize=address,undefined -fno-omit-frame-pointer" ..
# 线程：数据竞争
cmake -DCMAKE_CXX_FLAGS="-fsanitize=thread" ..
```

注意 **ASan 和 TSan 不能同时开**。实时控制代码里 ASan 的耗时（数倍）会让环路跑不满，
所以它适合跑单元测试和离线回放，不适合高实时测试项。

### perf

```bash
perf record -g ./my_node      # 采样 + 记录调用栈
perf report                   # 交互式看热点
perf stat ./my_node           # 只看 IPC、cache miss、分支预测失败率
```

`perf stat` 的 `cache-miss` 和 `branch-misses` 常常比火焰图更能说明问题：
同一条控制回路，如果 IPC 只有 0.6，先怀疑数据布局而不是算法。

## 依赖管理

### vcpkg

[vcpkg](https://vcpkg.io/) 用 CMake 的 toolchain 机制接入，一行就能让 `find_package` 找到库：

```bash
git clone https://github.com/microsoft/vcpkg && ./vcpkg/bootstrap-vcpkg.sh
cmake -DCMAKE_TOOLCHAIN_FILE=<vcpkg>/scripts/buildsystems/vcpkg.cmake ..
```

用 `vcpkg.json` 声明依赖（manifest 模式），版本锁在 `vcpkg-configuration.json` 里。
优点是库多（两千多个）且和 CMake 集成最顺；缺点是**源码编译，第一次装很慢**，
ARM 上更慢 —— 可以配二进制缓存（`VCPKG_BINARY_SOURCES`）解决。

### Conan

[Conan](https://conan.io/) 是独立的包管理器，不绑定构建系统，
支持预编译包下载、多配置（Debug/Release、不同编译器）、交叉编译的 profile 体系更完整。

代价是每个包要维护一份 recipe，遇到没人打包的库得自己写。
**库多且杂、要交叉编译到 ARM 时选 Conan；纯 CMake 工程选 vcpkg 更省事。**

> 无论用哪个，都别用系统包管理器（`apt install libfoo-dev`）装构建依赖：
> 版本随发行版走、无法复现，例：Ubuntu 20.04 和 22.04 上各种依赖版本可能完全不同（*冲突*）。

## 代码质量

### clang-tidy

静态检查。它和编译器警告的区别是：编译器只报语法与少数语义问题，
clang-tidy 能查「这个构造函数该标 `explicit`」「这个 `shared_ptr` 该改成 `unique_ptr`」
「这个函数该标 `const`」这类风格与正确性混杂的问题。

`.clang-tidy`（可直接用）：

```yaml
FormatStyle: file

Checks: |
  *bugprone*,
  *performance*,
  clang-analyzer-optin.cplusplus.VirtualCall,
  clang-analyzer-optin.performance.Padding,
  cppcoreguidelines-init-variables,
  cppcoreguidelines-prefer-member-initializer,
  cppcoreguidelines-pro-type-static-cast-downcast,
  cppcoreguidelines-slicing,
  google-explicit-constructor,
  llvm-namespace-comment,
  misc-definitions-in-headers,
  misc-misplaced-const,
  misc-non-copyable-objects,
  misc-static-assert,
  misc-throw-by-value-catch-by-reference,
  misc-uniqueptr-reset-release,
  misc-unused-parameters,
  modernize-avoid-bind,
  modernize-loop-convert,
  modernize-make-shared,
  modernize-redundant-void-arg,
  modernize-replace-auto-ptr,
  modernize-use-auto,
  modernize-use-bool-literals,
  modernize-use-default-member-init,
  modernize-use-emplace,
  modernize-use-equals-default,
  modernize-use-equals-delete,
  modernize-use-noexcept,
  modernize-use-nullptr,
  modernize-use-override,
  modernize-use-using,
  readability-avoid-const-params-in-decls,
  readability-braces-around-statements,
  readability-const-return-type,
  readability-container-size-empty,
  readability-delete-null-pointer,
  readability-else-after-return,
  readability-implicit-bool-conversion,
  readability-inconsistent-declaration-parameter-name,
  readability-make-member-function-const,
  readability-misplaced-array-index,
  readability-non-const-parameter,
  readability-qualified-auto,
  readability-redundant-function-ptr-dereference,
  readability-redundant-smartptr-get,
  readability-redundant-string-cstr,
  readability-simplify-subscript-expr,
  readability-static-accessed-through-instance,
  readability-static-definition-in-anonymous-namespace,
  readability-string-compare,
  readability-suspicious-call-argument,
  readability-uniqueptr-delete-release,
  # 下面这些在实践中噪音大于收益，关掉
  -bugprone-chained-comparison,
  -bugprone-easily-swappable-parameters,
  -bugprone-exception-escape,
  -bugprone-reserved-identifier,
  -bugprone-unused-raii,
  -performance-enum-size,
  -performance-inefficient-string-concatenation,

CheckOptions:
- key:             modernize-use-equals-default.IgnoreMacros
  value:           false
- key:             performance-for-range-copy.WarnOnAllAutoCopies
  value:           true
- key:             performance-inefficient-string-concatenation.StrictMode
  value:           true
- key:             performance-unnecessary-value-param.AllowedTypes
  value:           'exception_ptr$;'
- key:             readability-implicit-bool-conversion.AllowPointerConditions
  value:           true

HeaderFilterRegex: '^(include|src/headers)/.*\.(h|hpp)$'
```

两点经验：

- **`-bugprone-easily-swappable-parameters` 一定要关**。它会为
  `f(double x, double y)` 这种签名报警，机器人代码里遍地都是，一开就没法看。
- **老工程不要一次性全开**。先只对改动的文件跑（`git diff` 出文件列表传给它），
  否则第一天的报告有上万条，没人会看第二眼。

### clang-format

格式化。和 clang-tidy 共用 `.clang-format` / `FormatStyle: file`，
所以 IDE 里保存自动格式化、CI 里检查格式，用的是同一份规则。

```yaml
# 基于 Google C/C++ Code Style
Language: Cpp
BasedOnStyle: Google
AccessModifierOffset: -1
AlignAfterOpenBracket: Align
AlignConsecutiveAssignments: None
AlignOperands: Align
AllowShortBlocksOnASingleLine: Empty
AllowShortCaseLabelsOnASingleLine: false
AllowShortFunctionsOnASingleLine: Inline
# 强制每个 if 都带花括号：和 readability-braces-around-statements 配套
AllowShortIfStatementsOnASingleLine: Never
AllowShortLambdasOnASingleLine: Inline
AllowShortLoopsOnASingleLine: false
AlwaysBreakTemplateDeclarations: Yes
BreakBeforeBraces: Custom
BraceWrapping:
  AfterCaseLabel: false
  AfterClass: false
  AfterControlStatement: Never
  AfterEnum: false
  AfterFunction: false
  AfterNamespace: false
  AfterStruct: false
  BeforeCatch: false
  BeforeElse: false
  IndentBraces: false
  SplitEmptyFunction: false
  SplitEmptyNamespace: false
BreakConstructorInitializers: BeforeColon
ColumnLimit: 120
ContinuationIndentWidth: 4
DerivePointerAlignment: false
EmptyLineBeforeAccessModifier: LogicalBlock
FixNamespaceComments: true
IndentCaseLabels: true
IndentWidth: 4
MaxEmptyLinesToKeep: 1
NamespaceIndentation: None
PointerAlignment: Left
ReflowComments: false
SpaceAfterCStyleCast: false
SpaceBeforeCpp11BracedList: false
SpaceBeforeParens: ControlStatements
SpacesBeforeTrailingComments: 2
SpacesInAngles: false
Standard: c++17
TabWidth: 4
UseTab: Never
```

- `ColumnLimit: 120` 而不是 Google 默认的 80：现代屏幕放得下，模板与
  `Eigen` 表达式在 80 列下会被折得没法读。
- `Standard` 记得跟着项目实际标准改，它会影响 `SortIncludes` 等一批子规则的默认值。
- 临时不想被格式化：`// clang-format off` … `// clang-format on`。
  表格化的常量数组、手写的矩阵初始化很需要这个。

在 VS Code 里：装 clangd（或 C/C++ 扩展）与 clang-format 扩展，
把 `.clang-format` 放到项目根目录，`FormatStyle: file` 就会生效；
`Ctrl+Shift+I` 手动格式化，clang-tidy 的问题会直接标在编辑器里。

### Lizard

[Lizard](https://github.com/terryyin/lizard) 算圈复杂度（CCN）与函数长度，
用来找「该拆但一直没拆」的函数：

```bash
lizard -l cpp -C 15 src/        # 只列 CCN > 15 的函数
```

该工具不做数据流分析，不用指望它发现 bug；它的做的是把「这个函数太长了」
变成一条能进 CI 的硬指标。阈值推荐（CCN 20），只对新增代码生效。

---
::: tip 工具目标
到这里这套工具链就闭环了：**CMake 描述、Ninja 执行、vcpkg/Conan 供依赖、
gdb/rr 查崩溃、sanitizer 查内存与并发、perf 查性能、clang-tidy/clang-format
加 lizard 守质量**。
:::
::: warn 切记
真正的门槛不在单个工具，而在于把它们接进 CI，
让「不干净」的代码进不来 —— 靠人自觉维护的规范，三个月后就只剩文档了。
:::
