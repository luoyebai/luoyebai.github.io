---
title: 工程的构建与维护
slug: build-and-maintain
tags: [构建, CMake, Makefile, 视觉组教程]
summary: 从构建依赖到调试、测试与版本管理，补齐工具链和设计方法，把小程序维护成可靠工程。
order: 5
collection: windows-to-linux
origin: "https://github.com/luoyebai/doc_html/blob/HEAD/视觉组教程/从Windows到Linux/工程的构建与维护/main.md"
---

# 工程的构建与维护


--

目标：让另一个人拿到项目后，能构建、运行、验证并定位问题。


--

本课讲工程闭环；完整 CMake 与依赖练习见 [C++ 的构建与包管理](/docs/cpp-build-packages/)。

----
## 构建描述的是依赖关系


--

<!--fig:build-flow-->


--

源文件与头文件变化后，哪些目标需要重建？最终程序链接哪些库？


--

- 编译器：把源代码转换为目标代码。

--

- 构建工具：根据依赖执行命令，例如 Make、Ninja。

--

- 构建配置工具：描述目标并生成构建系统，例如 CMake。

--

- 包管理工具：获取与配置第三方依赖。


--

这些工具分工不同，并非简单的“旧工具升级成新工具”。

----
## 一个可维护的目录


--

```text
project/
  CMakeLists.txt
  include/       # 对外头文件
  src/           # 实现
  tests/         # 自动验证
  docs/          # 接口与使用说明
  build/         # 生成物，不提交到版本库
```


--

README 至少写清：环境、构建命令、运行入口、测试命令和一个预期结果。

----
## Make：目标名必须对应实际产物


--

下面示例假设 `main.c` 与 `sum.c` 都包含 `sum.h`。命令行开头是 **Tab**。


--

```makefile
CC = cc
CFLAGS = -std=c17 -Wall -Wextra -g
all: build/app
build/app: build/main.o build/sum.o
	$(CC) $^ -o $@
build/%.o: %.c sum.h | build
	$(CC) $(CFLAGS) -c $< -o $@
build:
	mkdir -p build
.PHONY: all
```


--

`$@` 是目标，`$<` 是第一个依赖，`$^` 是全部依赖。大型项目用自动头文件依赖生成或 CMake。

----
## CMake：围绕目标组织配置


--

<!--fig:cmake-flow-->


--

```cmake
cmake_minimum_required(VERSION 3.20)
project(example LANGUAGES C)
add_library(sum src/sum.c)
target_include_directories(sum PUBLIC include)
add_executable(app src/main.c)
target_link_libraries(app PRIVATE sum)
```


--

```bash
cmake -S . -B build
cmake --build build
```


--

尽量使用 `target_*` 设置依赖与编译选项，避免全局设置污染其他目标。

----
## 根据症状选择工具


--

| 问题 | 工具 | 提供的证据 |
|---|---|---|
| 编译问题 | 编译器诊断 | 类型、语法、符号 |
| 崩溃或状态错误 | GDB / LLDB | 调用栈、变量、断点 |
| 内存越界 | ASan / UBSan | 执行路径上的非法操作 |
| 可疑代码模式 | clang-tidy / cppcheck | 静态分析诊断 |
| 性能问题 | profiler / perf | 采样热点、计数器 |
| 并发协议性质 | SPIN 等模型检查器 | 有限模型内的反例或验证 |


--

静态分析、动态检测与模型检查各有边界，不能互相替代。

----
## 调试和性能分析分开进行


--

先确认结果正确，再决定哪里值得优化。


--

1. 定义负载、数据规模和性能指标。

--

2. 在带调试符号的优化构建上采样。

--

3. 检查 CPU、I/O、锁等待或内存是否是瓶颈。

--

4. 每次优化后复测正确性与耗时分布。


--

`perf` 受内核、权限与硬件事件支持影响；权限失败不是程序本身的故障。
不要根据一次耗时就宣布“快了两倍”。

----
## 测试覆盖行为边界


--

- 单元测试：算法与局部接口。

--

- 集成测试：模块接线、文件格式、通信契约。

--

- 回归测试：已修复缺陷的触发条件。

--

- 系统验证：在目标环境下的完整任务。


--

测试应有明确预期，失败时返回非零状态。发布构建里不要只依赖可能被关闭的 `assert`。


--

CI 至少从干净目录执行配置、构建和测试，避免依赖开发机残留文件。

----
## 文档记录接口的责任


--

```cpp
// 输入：非空、以米为单位的测量序列。
// 返回：均值；包含非有限值时报告输入错误。
// 所有权：只读取数据，不保存调用者的地址。
double mean_distance(const std::vector<double>& samples);
```


--

Doxygen 等工具能提取注释，不能替你决定接口约定。
示例、单位、错误路径、线程安全性与生命周期，通常比重复函数名更有用。

----
## Git：让修改可理解、可回退


--

```bash
git status
git diff
git add src/sum.c tests/test_sum.c
git diff --staged
git commit -m "Handle empty measurements explicitly"
```


--

一次提交围绕一个清楚的问题；先查看暂存内容，再提交。
调查回归可使用 `git bisect`，但需要稳定的通过/失败判据。

----
## 环境可复现不止靠容器


--

记录编译器、依赖版本、构建选项、目标架构与测试数据。


--

容器封装用户空间，不自动固定宿主内核、GPU 驱动或硬件时序。
镜像应记录来源与版本；项目依赖仍应明确声明，构建不要依靠交互式手工安装的残留状态。


--

涉及硬件的测试，在报告中区分“容器内通过”和“目标设备通过”。

----
## 选择范式：从变化方向出发


--

| 方法 | 适合表达 | 需要控制的成本 |
|---|---|---|
| 过程式 | 清晰的步骤和状态更新 | 避免全局状态耦合 |
| 面向对象 | 数据与不变量、可替换行为 | 避免无必要的继承层次 |
| 泛型 | 多种类型共享算法 | 控制模板复杂度与诊断成本 |
| 函数式思想 | 纯计算、不可变数据 | 管理复制与外部副作用 |


--

一个工程可以组合多种方法，不必把所有模块写成同一种形状。

----
## 设计模式用来解决具体变化


--

机器人日志可以写终端、文件或网络：把“写入目的地”作为可替换策略。


--

```cpp
struct Sink {
    virtual ~Sink() = default;
    virtual void write(const std::string& text) = 0;
};
void report(Sink& sink, const std::string& message) {
    sink.write(message);
}
```


--

片段需包含 `<string>` 并由具体 Sink 实现 `write`。小项目也可传回调，不必为了模式添加继承。

----
## 练习：交付一个小工程


--

把求和程序整理成库、应用和测试三部分。


--

验收标准：


--

1. 在新构建目录中成功配置和构建。

--

2. 修改头文件会触发相关目标重编译。

--

3. 人为改错算法后测试必须失败。

--

4. README 中的命令与实际文件一致。


--

参考：[CMake 教程](https://cmake.org/cmake/help/latest/guide/tutorial/index.html)、[GNU Make 手册](https://www.gnu.org/software/make/manual/make.html)、[C++ 核心准则](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines)。
