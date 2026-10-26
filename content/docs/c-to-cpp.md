---
title: 从 C 语言到 C++ 的转变
slug: c-to-cpp
collection: cpp
order: 1
tags: [C, C++, RAII, 编程范式, 视觉组教程]
summary: 用 RAII、值语义、容器和模板改进 C 风格代码，理解引用、移动与所有权的实际边界。
---

# 从 C 语言到 C++


--

本课以 C++17 为基线。目标：用类型表达资源责任，减少分散在各个出口的清理代码。


--

C 和 C++ 都要求理解内存与接口；采用新特性前先说清楚它解决的具体问题。

----
## 从资源清理开始


--

```c
#include <stdio.h>
int read_first(const char *path) {
    FILE *file = fopen(path, "r");
    if (!file) return -1;
    int value = fgetc(file);
    int failed = ferror(file);
    if (fclose(file) == EOF) failed = 1;
    return failed ? -1 : value;
}
```


--

这是“读取首字节”的简化接口，空文件与读取错误都返回负值；需要区分时应设计独立状态码。
C 可以通过统一清理出口管理资源，但新增分支仍需要检查清理路径。

----
## RAII：对象负责资源生命周期


--

<!--fig:cpp-raii-->


--

```cpp
#include <fstream>
#include <stdexcept>
#include <string>
std::string first_line(const std::string& path) {
    std::ifstream file(path);
    if (!file) throw std::runtime_error("open failed");
    std::string line;
    if (!std::getline(file, line))
        throw std::runtime_error("no readable first line");
    return line;
}
```


--

普通返回和异常展开时，局部流对象析构并关闭文件。RAII 同样适用于锁与内存。
进程强制终止不保证析构；对写文件，仍需显式检查写入或关闭错误。

----
## 参数类型表达不同责任


--

| 参数 | 常见含义 | 仍需注意 |
|---|---|---|
| `T value` | 持有独立参数对象 | 可能拷贝或移动 |
| `T& value` | 借用可修改对象 | 引用也可能悬垂 |
| `const T& value` | 通过该引用只读 | 不能保证其他别名不会修改 |
| `T* value` | 借用地址，可能为空 | 说明长度、生命周期与可空性 |


--

引用在有效程序中绑定对象，但不会自动延长任意被引用对象的生命周期。

----
## 优先让容器管理存储


--

```cpp
#include <algorithm>
#include <vector>
int main() {
    std::vector<int> values{5, 2, 9, 1};
    std::sort(values.begin(), values.end());
    return values == std::vector<int>{1, 2, 5, 9} ? 0 : 1;
}
```


--

`std::sort` 要求随机访问迭代器；`std::list` 使用自身的 `sort`。
`vector` 扩容可能使原来的指针、引用和迭代器失效，容器不消除生命周期问题。

----
## 模板代替有副作用的宏


--

```cpp
template<class T>
T max_value(T a, T b) {
    return a > b ? a : b;
}
```


--

这个按值示例适用于可复制且可比较的小类型，不返回临时对象的引用。


--

宏 `MAX(i++, j++)` 会先比较两个表达式，再重复求值被选中的表达式，产生额外副作用。
C 也有 `qsort` 等通用接口；模板提供另一种类型化复用方式，并非“C 只能复制粘贴”。

----
## 所有权优先保持简单


--

```cpp
#include <memory>
#include <utility>
struct Sensor { int id; };
int main() {
    auto sensor = std::make_unique<Sensor>(Sensor{7});
    auto owner = std::move(sensor);
    return !sensor && owner->id == 7 ? 0 : 1;
}
```


--

优先直接持有值；确需动态生命周期时，用 `unique_ptr` 表达独占。
只有需要共享所有权时才使用 `shared_ptr`；`weak_ptr` 可观察而不增加强引用计数。
智能指针的大小和成本受删除器等因素影响，不能统称“零开销”。

----
## std::move 不负责搬运


--

`std::move` 是转换为适合移动重载选择的表达式；真正转移资源的是随后调用的构造或赋值操作。


--

- 类型没有合适的移动操作时，可能发生复制。

--

- `const` 对象经 `std::move` 后仍带 const，常常不能调用普通移动构造。

--

- 移动后的标准库对象通常有效但值未指定，除非具体接口承诺更多。

--

- 移动后的 `unique_ptr` 明确为空，因此上一页可以检查它。

----
## constexpr 与泛型的边界


--

```cpp
constexpr int square(int x) { return x * x; }
static_assert(square(4) == 16);
```


--

`constexpr` 函数满足条件时可用于常量求值，也可以在运行时调用。
模板实例化可以避免某些运行时分派，但编译时间、代码体积和算法成本依然存在。


--

先掌握 RAII、`const`、容器与标准算法，再为确实存在的变化引入模板或接口继承。

----
## 练习与答案


--

为什么这个接口危险：`const T& maximum(const T& a, const T& b)`？


--

**答案**：若调用传入临时对象，返回的引用可能在完整表达式结束后悬垂。对小值使用按值返回，或明确限制调用方生命周期。


--

构建示例：`c++ -std=c++17 -Wall -Wextra example.cpp -o example`。


--

参考：[C++ 核心准则：资源管理](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#S-resource)、[C++ 工作草案：move](https://eel.is/c++draft/forward)。
