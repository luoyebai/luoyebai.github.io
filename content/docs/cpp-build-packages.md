---
title: C++ 的构建与包管理
slug: cpp-build-packages
collection: windows-to-linux
order: 6
tags: [C++, CMake, CTest, 包管理, 视觉组教程]
summary: 用一个可下载的 C++17 工程串起 CMake、CTest、依赖发现和包管理，理解可复现构建。
---

# C++ 的构建与包管理


--

目标：从空目录构建一个库、应用与测试，再理解如何引入外部包。


--

基线：C++17 编译器、CMake ≥ 3.20。示例不需要联网下载第三方依赖。

----
## 三个阶段分别负责什么


--

```text
配置 configure → 检查环境、建立目标与依赖
生成 generate  → 输出 Ninja / Make / IDE 构建文件
构建 build     → 编译、归档、链接
```


--

CMake 不替代编译器；包管理器不替代 CMake。
依赖能下载，不代表架构、ABI、编译选项与当前项目兼容。

----
## 获取完整示例


--

下载 [工程 ZIP](/assets/docs/cpp-build-packages/starter.zip)，解压后进入含 `CMakeLists.txt` 的目录。


--

```text
CMakeLists.txt
include/lesson/clamp.hpp
src/clamp.cpp
src/main.cpp
tests/test_clamp.cpp
```


--

函数 `clamp_value` 将整数限制在闭区间内；区间上下界反转时抛出 `std::invalid_argument`。
练习关注工程组织，不依赖复杂算法。

----
## 把依赖挂到目标上


--

```cmake
cmake_minimum_required(VERSION 3.20)
project(lesson LANGUAGES CXX)
add_library(lesson src/clamp.cpp)
target_include_directories(lesson PUBLIC include)
target_compile_features(lesson PUBLIC cxx_std_17)
add_executable(lesson_demo src/main.cpp)
target_link_libraries(lesson_demo PRIVATE lesson)
include(CTest)
if(BUILD_TESTING)
  add_executable(lesson_tests tests/test_clamp.cpp)
  target_link_libraries(lesson_tests PRIVATE lesson)
  add_test(NAME clamp_contract COMMAND lesson_tests)
endif()
```


--

消费者链接 `lesson` 时也获得其 PUBLIC 头文件路径与标准要求。

----
## 配置、构建、测试


--

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build --config Debug
ctest --test-dir build -C Debug --output-on-failure
```


--

Ninja / Make 单配置生成器使用 `CMAKE_BUILD_TYPE`；Visual Studio 等多配置生成器在构建与测试时选配置。


--

单配置运行 `./build/lesson_demo`；Windows Visual Studio 通常运行 `build\Debug\lesson_demo.exe`。
预期输出 `10`，测试报告 `clamp_contract` 通过。

----
## PRIVATE、PUBLIC、INTERFACE


--

| 关键字 | 当前目标使用 | 消费者继承 |
|---|---|---|
| PRIVATE | 是 | 否 |
| PUBLIC | 是 | 是 |
| INTERFACE | 否 | 是 |


--

实现文件内部需要的库通常 PRIVATE；公开头文件使用某依赖的类型时，消费者也需要对应使用要求。
静态库最终链接还有传递链接语义，不能把 PRIVATE 简化为“最终程序永远不需要该库”。

----
## 让测试在 Release 中也有效


--

下载示例通过条件判断和非零退出码报告失败，不依赖会受 `NDEBUG` 影响的 assert。


--

测试包含：范围内、低于下界、高于上界、上下界相同、反转区间。


--

练习：暂时把函数写成总返回输入值，测试应失败；恢复实现后再通过。
能识别故意引入的错误，才证明测试覆盖到了这个行为。

----
## find_package 并不负责下载


--

引入 fmt 的消费端配置示意：


--

```cmake
find_package(fmt CONFIG REQUIRED)
target_link_libraries(lesson_demo PRIVATE fmt::fmt)
```


--

它查找已安装或由工具链提供的包配置与 imported target。
头文件找不到、链接符号找不到、运行时共享库找不到，分别属于不同阶段。


--

避免手工硬编码某台电脑上的绝对 include/lib 路径。

----
## vcpkg：用清单声明依赖


--

已安装 vcpkg 并设置 `VCPKG_ROOT` 后，可在项目添加：


--

```json
{"name":"lesson-app","version-string":"0.1.0","dependencies":["fmt"]}
```


--

Bash 示例，使用独立构建目录：


--

```bash
cmake -S . -B build-vcpkg \
  -DCMAKE_TOOLCHAIN_FILE="$VCPKG_ROOT/scripts/buildsystems/vcpkg.cmake"
cmake --build build-vcpkg
```


--

清单保存为 `vcpkg.json`，并配合上一页的 `find_package`。
团队项目还应记录 baseline / registry 和目标 triplet；仅写包名不能锁定完整依赖状态。

----
## Conan 2：显式安装与工具链


--

替代路线：已安装 Conan 2 后，在 `conanfile.txt` 声明依赖与生成器：


--

```ini
[requires]
fmt/11.0.2
[generators]
CMakeDeps
CMakeToolchain
```


--

```bash
conan profile detect
conan install . --output-folder=build-conan --build=missing -s build_type=Release
cmake -S . -B build-conan -DCMAKE_TOOLCHAIN_FILE=conan_toolchain.cmake -DCMAKE_BUILD_TYPE=Release
cmake --build build-conan --config Release
```


--

固定版本是教学示例，远端配方可用性需核对。检测出的 profile 需检查，团队应保留锁文件与配置。

----
## 构建缓存不是源代码


--

更换编译器、工具链或 ABI 时使用新的构建目录，避免旧 cache 残留。


--

记录：


--

- 编译器与标准库版本、目标架构。

--

- 包版本、baseline / lockfile、工具链配置。

--

- Debug / Release、静态或动态链接等选项。

--

- 同一套配置下的测试结果。


--

交叉编译还要区分构建机和目标机；构建成功不代表程序可以在宿主运行。

----
## 练习与参考


--

给库增加 `is_in_range(value, low, high)`，定义反转区间行为，再加入测试。


--

验收：一个新目录内三条命令完成配置、构建、测试；修改实现后测试可发现错误；README 不依赖本机私有路径。


--

参考：[CMake 教程](https://cmake.org/cmake/help/latest/guide/tutorial/index.html)、[vcpkg 清单模式](https://learn.microsoft.com/en-us/vcpkg/consume/manifest-mode)、[Conan 2 CMake 教程](https://docs.conan.io/2/tutorial/consuming_packages/build_simple_cmake_project.html)。
