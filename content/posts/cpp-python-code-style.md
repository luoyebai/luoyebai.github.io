---
title: C++ / Python 代码规范
slug: cpp-python-code-style
date: 2025-10-12
updated: 2026-10-02
tags: [C++, Python, 系统工程]
summary: 一份可以贴进项目仓库的代码规范：头文件自给自足与 include 顺序、命名空间与静态变量、类的隐式转换与继承、函数签名怎么设计、命名约定，以及平台相关代码不能假设什么。核心是「正确性优先，必要时才为优化让路」。
cover: assets/uploads/w5opq7-w5opq7-d521b09390.webp
featured: false
draft: false
archived: false
---

::: note 迁移说明
骨架来自 Google C++ Style Guide 与 C++ 核心准则，正文按团队实践重写过；本章标题去掉了公司前缀，模板压缩包未随导出保留。
:::

## 从这里开始

| 你要查什么 | 直接进入 |
| --- | --- |
| C++ 的头文件、类、函数与资源管理 | [C++ 代码规范](#c-代码规范) |
| Python 的格式、类型、异常与工程约定 | [Python 代码规范](#python-代码规范) |
| 命名、注释与格式工具 | [命名约定](#命名约定和注释) · [格式检查](#代码格式及相关检查工具) |
| 不同系统和架构的兼容问题 | [平台注意事项](#操作系统架构-平台相关注意事项) |

### 提交前的 10 条速查

1. **头文件自给自足。** 单独 include 也能编译；不要依赖别的头文件恰好先被引入。
2. **所有权写清楚。** 优先值语义与 RAII；借用、转移和释放资源的责任不能靠猜。
3. **接口表达约束。** 用类型、`const` 和必要的检查说明什么可以为空、什么允许修改。
4. **转换要可见。** 注意隐式转换、窄化、符号与无符号混算，尤其是长度和时间戳。
5. **命名统一。** 同一项目保持一套约定，名字体现用途；单位和坐标系写到读者看得到的地方。
6. **Python 用 4 个空格缩进。** 避免混用 Tab；与团队既有格式保持一致。
7. **类型标注描述真实接口。** Python 的标注不会自动检查运行时输入，需要校验时明确写出。
8. **异常要有处理边界。** 不静默吞异常；文件、锁和其他资源用上下文管理器或 RAII 可靠释放。
9. **让工具处理格式。** 使用项目统一的格式和静态检查配置，把评审时间留给行为与边界。
10. **检查平台假设。** 整数宽度、字节序、路径与线程行为都有环境前提；用测试记录这些前提。

这份速查用于提交前自检，具体例外与原因见下方完整说明。C++ 与 Python 各自的工具和语义不应混为一套规则。

## 概述

本文档旨在提供 C++/Python 的代码规范和指南，这些规范会在保持代码易于管理的同时, 不影响程序员高效地使用，其核心要点包括

- 避免使用奇特或危险的语法结构

- 安全可靠（正确性）为第一原则

- 在必要时为优化让路

我们限定 C++ 版本为 C++ 17 以上 。

> 编译器选择 GCC 12，Clang 15+，其中部分 C++20 使用 GSL（Guidelines Support Library） 库代替实现。

参考文档：

https://github.isocpp.org.cn/CppCoreGuidelines/CppCoreGuidelines#S-tools

https://zh-google-styleguide.readthedocs.io/en/latest/google-cpp-styleguide/index.html

[PEP 8 · Python 代码风格指南（中文）](https://peps.pythonlang.cn/pep-0008/)

> 本指南并非 C++/Python 教程, 我们假定读者已经非常熟悉 C++/Python。

---

## C++ 代码规范

### 头文件

#### 所有头文件应该自给自足

**含义**：头文件应该自给自足，即可单独进行编译。并以 .h 和 .hpp 作为文件名后缀，其中 C 语言部分使用 .h，C++ 部分使用 .hpp。

**示例**：该规范具体包括两点，1是头文件应当包含其所依赖的所有头文件，2是头文件需要头文件防护符。

```cpp
// 头文件导入顺序应当遵循以下顺序
// STD -> C/C++ 标准库
#include <vector>
// LINUX -> 平台库
#include <sys/select.h>
*// EIGEN -> 系统第三方库*
#include <Eigen/Core>
// TOOL -> 当前项目库
#include "xxx.hpp"

Eigen::VectorXd  CreateEigen(std::vector<int> x) {
    return Eigen::VectorXd{x};
}
```

```cpp
// 头文件防护符形式1
#ifndef XXX_HPP
#define XXX_HPP
// ...
#endif // XXX_HPP

// 头文件防护符形式2
#pragma once
```

- 我们使用 `#pragma once` 而不是 `#define` 防护符来防止重复导入。因为它需要命名，可能宏冲突。

- 这仅仅是为了统一命名规范（无需考虑头文件路径），当然，`#pragma once` 并非 ISO 标准。然而主流编译器都支持 `#pragma once`，因此在工程实践中它几乎可以视为“事实标准”。

#### 前向声明

**含义**：前向声明 (forward declaration) 是没有对应定义 (definition) 的声明。

**示例**：bad

```cpp
// 在 C++ 源码文件中：
class B;
void FuncInB();
extern int variable_in_b;
ABSL_DECLARE_FLAG(flag_in_b);
```

使用前向声明能节约编译时间，不需要重复编译头文件，缺点是隐藏了依赖关系, 可能会让人忽略头文件变化后必要的重新编译过程，同时对自动分析工具不太友好，编译器也可能因为前向声明导致行为发生变化。

```cpp
// b.h:
struct B {};
struct D : B {};

// good_user.cc:
#include "b.h"
void f(B*);
void f(void*);
void test(D* x) {
    f(x);
}  // 调用 f(B*)
```

若用 `B` 和 `D` 的前向声明替代 `#include`, `test()` 会调用 `f(void*)` 。

尽量避免使用前向声明，应该直接引入你需要的头文件。仅在如 IMPL 情况下需要使用前向声明。

#### `#include` 的路径及顺序

头文件的路径应相对于项目源码目录, 不能出现 UNIX 目录别名 (alias) `.` (当前目录) 或 `..` (上级目录). 例如, 应该按如下方式导入 `project/include/xxx/xxx.hpp`，理想情况下，只应该出现 `xxx/xxx.hpp`。

有时平台相关的 (system-specific) 代码需要有条件地导入 (conditional include)，此时可以在其他导入语句后放置条件导入语句. 当然, 尽量保持平台相关的代码简洁且影响范围小。

示例：

```cpp
#include "foo/public/fooserver.h"
#include "base/port.h"  // 为了 LANG_CXX11.
#ifdef LANG_CXX11
#include <initializer_list>
#endif  // LANG_CXX11
```

大部分头文件应当放在代码开头，然而有一种例外，仅将 `#include`作为复制粘贴使用。

示例：

```cpp
*// 通过 include 将部分工具生成的代码（如idl、proto、xml等）嵌入*
    *// clang-format off*
#include "idl/xxx.pybind.ipp"
    // ...
*    // clang-format on*
```

有些时候需要按照特定顺序导入文件，此时需要将格式化关闭，防止导入顺序发生变化。

---

### 作用域

#### 命名空间

**含义**：命名空间可以将全局作用域 (global scope) 划分为独立的、有名字的作用域, 因此可以有效防止全局作用域中的命名冲突 (name collision)。

命名空间可以避免大型程序中的命名冲突, 同时代码可以继续使用简短的名称。

举例来说, 若两个项目的全局作用域中都有一个叫 `Foo` 的类 (class), 这两个符号 (symbol) 会在编译或运行时发生冲突. 如果每个项目在不同的命名空间中放置代码, `project1::Foo` 和 `project2::Foo` 就是截然不同的符号, 不会冲突。

**示例**：内联命名空间会自动把其中的标识符置入外层作用域

```cpp
namespace outer {
inline namespace inner {
    void foo();
    }  // namespace inner
}  // namespace outer
```

部分情景下, 我们必须多次使用完全限定名称 (fully-qualified name) 来引用符号. 此时多层嵌套的命名空间会让代码冗长。

- 禁止使用 *using 指令* 引入命名空间的所有符号。

    ```cpp
    // 禁止: 这会污染命名空间
    using namespace foo;
    ```

- 除了在明显标注为内部使用的命名空间内, 不要让头文件引入命名空间别名 (namespace alias)。这是因为头文件的命名空间中引入的任何东西都是该文件的公开 API。

    ```cpp
    // 在 .c 中, 用别名缩略常用的名称
    namespace baz = ::foo::bar::baz;
    ```

#### 局部变量

应该尽可能缩小函数变量的作用域 （scope），并在声明的同时初始化。

示例 bad：

```cpp
int i;
i = f();     // 不好: 初始化和声明分离.
```

示例 good：

```cpp
int i = f(); // 良好: 声明时初始化。
```

示例：类初始化尽量使用花括号初始化

```cpp
vector<int> v;
v.push_back(1);
v.push_back(2);
// 用花括号初始化更好，C++17 以上
vector<int> v = {1,2};

```

示例：需要注意的是， 如果变量是一个对象， 那么它每次进入作用域时会调用构造函数，每次退出作用域时都会调用析构函数

```cpp
// 低效的实现:
for (int i = 0; i < 1000000; ++i) {
    Foo f;  // 调用 1000000 次构造函数和析构函数
    f.DoSomething(i);
}
// 在循环的作用域外面声明这类变量更高效
Foo f;  // 调用 1 次构造函数和析构函数
for (int i = 0; i < 1000000; ++i) {
    f.DoSomething(i);
}
```

#### 静态变量和全局变量及 thread_local 变量

**含义**：

- 每个对象 （object）都有与生命周期 （linetime）相关的储存周期 （storage duration）。 静态储存周期对象的存活时间是从程序初始化开始, 到程序结束为止。 这些对象可能是命名空间作用域内的变量 （全局变量）、类的静态数据成员或者用 `static` 修饰符 （specifier）声明的函数局部变量。 对于函数局部静态变量， 初始化发生在在控制流第一次经过声明时；所有其他对象会在程序启动时初始化。 程序退出时会销毁所有静态储存周期的对象 （这发生在未汇合 （join） 的线程终止前）。

- 初始化过程可以是动态 （dynamic）的， 也就是初始化过程中有不平凡 （non-trivial）的操作。 （例如,  会分配内存的构造函数, 或者用当前进程 ID 初始化的变量。） 其他初始化都是静态 （static） 初始化. 二者并非水火不容：  静态储存周期的变量 **一定** 会静态初始化 （初始化为指定常量或给所有字节清零），必要时会随后再次动态初始化。

示例：

```cpp
const int KNUM = 10;  // 允许
struct X { int n; };
const X KX[] = {{1}, {2}, {3}};  // 允许
void foo() {
    static const char* const messages[] = {"hello", "world"};  // 允许
}
// 允许: constexpr 可以保证析构函数是平凡的
constexpr std::array<int, 3> KARRAY = {1, 2, 3};

// 不好: 非平凡的析构
const std::string KFOO = "foo";
// 和上面相同的原因, 即使 kBar 是引用 (该规则也适用于生命周期被延长的临时对象)
const std::string& KBAR = StrCat("a", "b", "c");
void bar() {
    // 不好: 非平凡的析构
    static std::map<int, int> data = {{1, 0}, {2, 0}, {3, 0}};
}
```

- 我们可以用 `thread_local` 修饰符声明变量：这样的变量本质上其实是一组不同的对象。 不同线程访问该变量时，会访问各自的对象。`thread_local` 变量在很多方面类似静态储存周期的变量。 例如，可以在命名空间内、函数内或类的静态成员内声明这些变量， 但不能在类的普通成员内声明它们。

- `thread_local` 实例与静态变量的初始化过程类似， 区别是 `thread_local` 实例会在每个线程启动时初始化， 而非程序启动时初始化。 这意味着函数内的 `thread_local` 变量是线程安全的。 若要访问其他 `thread_local` 变量， 则有跟静态变量一样的初始化顺序问题 (而且问题更大)。

- `thread_local` 的变量也有微妙的析构顺序问题： 线程终止时， `thread_local` 的销毁顺序是初始化顺序的逆序 (正如 C++ 在其他部分的规则一样)。 如果 `thread_local` 的变量在析构过程中访问了该线程中已销毁的其他 `thread_local` 变量， 就会出现难以调试的释放后使用 (use-after-free, 即野指针) 问题。建议优先使用 `thread_local` 定义线程的局部数据， 而非其他机制。

> 头文件中通常使用 `inline` 来定义全局变量，而源文件中通常使用 `static`

---

### 类

类 （class）是 C++ 中最常见的代码单元。 因此，类在 C++ 中被广泛使用。 本节将列出编写类时需要注意的事项。

#### 构造函数的内部操作

**含义**：构造函数可以执行任意初始化操作。

- 无需担心类是否已经初始化。

- 由构造函数完全初始化的对象可以是 `const` 类型， 也方便在标准容器或算法中使用。

- 但构造函数处理错误通常需要依靠错误码，或是异常来表示（可能造成资源泄漏），其中错误码还需要在后续使用中额外判断，因此在不考虑性能的情况下使用异常是较好的选择（即底层尽量使用错误码，上层使用异常防止崩溃）。

#### `struct`和`class` 的选择

如果类具有不变式，则使用 `class`；如果数据成员可以独立变化，则使用 `struct`。

**原因**：可读性。易于理解。使用 `class` 会提醒程序员注意不变式的必要性。这是一个有用的约定。

不变式是对象成员的逻辑条件，构造函数必须建立该条件，以便公共成员函数可以假定它。在建立不变式后（通常由构造函数），对象的所有成员函数都可以被调用。不变式可以非正式地（例如，在注释中）或更正式地使用 `Expects` 来声明。如果所有数据成员都可以独立于彼此变化，则不可能存在不变式。

示例：

```cpp
struct Pair {  // 成员可以独立变化
    string name;
    int volume;
};
// 但是 class
class Date {
public:
    // 验证 {yy, mm, dd} 是否为有效日期并初始化
    Date(int yy, Month mm, char dd);
    // ...
private:
    int y;
    Month m;
    char d;
};
```

如果一个类有任何 `private` 数据，用户就不能在不使用构造函数的情况下完全初始化一个对象。因此，类定义者将提供一个构造函数，并且必须指定其含义。这实际上意味着定义者需要定义一个不变式。

#### 隐式类型转换

> 不要定义隐式类型转换。 定义类型转换运算符和单个参数的构造函数时， 请使用 `explicit` 关键字 (keyword)。

在构造函数或类型转换运算符上添加 `explicit` 关键字，确保使用者必须明确指定目标类型。

示例：

```cpp
class Foo {
    explicit Foo(int x, double y);
    // ...
};

void Func(Foo f);

// 下面会报错
Func({42, 3.14});
```

在类的定义中， 类型转换运算符和单参数构造函数都应该标记为 `explicit`。 拷贝和移动构造函数除外， 因为它们不执行类型转换。

对于某些可互换的类型， 隐式类型转换是必要且恰当的， 例如两种类型的对象只是同一底层值的不同表示形式。 此时请联系项目负责人申请豁免。

接受多个参数的构造函数可以省略 `explicit` 标记。 接受单个 `std::initializer_list` 参数的构造函数也应该省略 `explicit` 标记， 以支持拷贝初始化  (copy-initialization， 例如 `MyType m = {1, 2};`)。

#### 成员数据类型的选择

结构体、数对还是元组？

如果可以给成员起一个有意义的名字，应该用结构体而不是数对 (pair) 或元组 (tuple)。

虽然使用数对和元组可以免于定义自定义类型，从而节省编写代码的时间, 但是有意义的成员名称通常比 `.first`， `.second` 和 `std::get<X>` 更可读。 C++14 引入了 `std::get<Type>`， 只要某类型的元素唯一， 就可以根据类型而非下标来访问元组元素。 这在一定程度上缓解了问题， 但成员名称通常比类型名称更清晰、更有信息量。

数对和元组适合通用代码， 因为其中的元素没有特定含义。 与现有代码或 API 交互时也可能需要它们。

> 如果你需要一个成员指向某个东西，请使用指针（原始指针或智能指针，如果它不应该是 null，则使用 `gsl::not_null`）而不是引用。

示例：优先使用具体类型而非类层次结构

```cpp
class Point1 {
    int x, y;
    // ... operations ...
    // ... no virtual functions ...
};

class Point2 {
    int x, y;
    // ... operations, some virtual ...
    virtual ~Point2();
};

void use()
{
    Point1 p11 {1, 2};   // 栈对象
    Point1 p12 {p11};    // 拷贝

    // 通常不需要这样
    auto p21 = make_unique<Point2>(1, 2);   // 堆上创建
    auto p22 = p21->clone();                // 拷贝
    // ...
}
```

如果一个类是层次结构的一部分，我们（在实际代码中，即使不一定在小的示例中）必须通过指针或引用来操作它的对象。这意味着更多的内存开销、更多的分配和释放，以及更多的运行时开销来执行由此产生的间接引用。

#### 继承

> 通常情况下， 组合（composition）比继承（inheritance）更合适。

**含义**：当子类继承基类时， 子类会包含基类定义的所有数据及操作。 **接口继承** （interface inheritance） 指从纯抽象基类 （pure abstract base class， 不包含状态或方法定义） 继承； 所有其他继承都是 **实现继承** (implementation inheritance)。

接口继承可以强制一个类公开特定 API。 当类没有定义 API 中的方法时， 编译器可以检测到错误。大部分时候只需要接口继承即可，有时 CRTP 可以帮助我们实现静态多态。

尽量不要使用继承，大部分时候用组合好得多。

#### 运算符重载

**含义**：用户可以使用 `operator` 关键字来重载内置运算符， 前提是其中一个参数是用户自定义类型。 用户还可以使用 `operator""` 定义一类新的字面量， 或者定义类型转换函数 (例如 `operator bool()`)。

- 重载运算符可以让用户定义的类型拥有与内置类型相似的行为， 使得代码更简洁直观。 重载运算符相当于特定操作的惯用名称 （例如 `==`, `<`, `=`, `<<`）。 若用户定义的类型符合这些习惯， 则代码更易读， 并便于与使用这些名称的库进行互操作。

- 自定义字面量提供了一种创建自定义类型对象的简洁写法。

示例：制作基本物理单位

```cpp
*// v = d / t*
constexpr Velocity operator/(Length d, Time t) noexcept {
    return Velocity(d.value() / t.value());
}

constexpr Length operator"" _m(long double v) {
    return Length(static_cast<double>(v));
}

constexpr Time operator"" _s(long double v) {
    return Time(static_cast<double>(v));
}

// 计算速度
auto speed = 10.0_m / 1.0_s;
```

#### 可见性和声明次序

类的 *所有* 数据成员应该声明为私有 （private）， 除非是常量。 这样做可以简化类的不变式 （invariant）逻辑，代价是需要增加一些冗余的访问器 （accessor）代码 （通常是 const 方法）。

将相似的声明放在一起。 公有 （public）部分放在最前面。

---

### 函数

#### 函数应当执行单一逻辑

**原因**：执行单一操作的函数更易于理解、测试和复用。

示例：考虑

```cpp
void read_and_print() { // bad
    int x;
    cin >> x;
    // check for errors
    cout << x << "\n";
}
```

这是一个与特定输入绑定的庞然大物，永远找不到另一个（不同的）用途。相反，将函数分解为合适的逻辑部分并进行参数化。

```cpp
int read(istream& is) { // better
    int x;
    is >> x;
    // check for errors
    return x;
}

void print(ostream& os, int x) {
    os << x << "\n";
}
```

现在可以在需要的地方组合这些。

```cpp
void read_and_print() {
    auto x = read(cin);
    print(cout, x);
}
```

如果需要，我们可以进一步模板化数据类型、I/O 机制、对错误的响应等上的 `read()` 和 `print()`。

```cpp
auto read = [](auto& input, auto& value) { // better
    input >> value;
    // check for errors
};

void print(auto& output, const auto& value) {
    output << value << "\n";
}
```

- 将具有多个“输出”参数的函数视为可疑。改用返回值，包括用于多个返回值的 `tuple`。

- 将不适合在单个编辑器屏幕上显示的大函数视为可疑。考虑将此类函数分解为更小的、命名良好的子操作。

- 将具有 7 个或更多参数的函数视为可疑。

#### 保持函数简短且简单

**原因**：大函数难以阅读，更有可能包含复杂代码，并且更有可能在比最小范围大的范围内拥有变量。具有复杂控制结构的函数更有可能冗长，并且更有可能隐藏逻辑错误。

示例：

```cpp
double simple_func(double val, int flag1, int flag2) {
    // simple_func: takes a value and calculates the expected ASIC output,
    // given the two mode flags.
    double intermediate;
    if (flag1 > 0) {
        intermediate = func1(val);
        if (flag2 % 2)
             intermediate = sqrt(intermediate);
    }
    else if (flag1 == -1) {
        intermediate = func1(-val);
        if (flag2 % 2)
             intermediate = sqrt(-intermediate);
        flag1 = -flag1;
    }
    if (abs(flag2) > 10) {
        intermediate = func2(intermediate);
    }
    switch (flag2 / 10) {
    case 1: if (flag1 == -1) return finalize(intermediate, 1.171);
            break;
    case 2: return finalize(intermediate, 13.1);
    default: break;
    }
    return finalize(intermediate, 0.);
}
```

重构为

```cpp
double func1_muon(double val, int flag) {
    // ???
}

double func1_tau(double val, int flag1, int flag2) {
    // ???
}

double simple_func(double val, int flag1, int flag2) {
    // simple_func: takes a value and calculates the expected ASIC output,
    // given the two mode flags.
    if (flag1 > 0)
        return func1_muon(val, flag2);
    if (flag1 == -1)
        // handled by func1_tau: flag1 = -flag1;
        return func1_tau(-val, flag1, flag2);
    return 0.;
}
```

- “不适合屏幕”通常是“太大”的一个很好的实际定义。应将一到五行函数视为正常。

- 标记不“适合屏幕”的函数。屏幕有多大？尝试 60 行乘以 140 个字符；这大致是书籍页面上最舒适的尺寸。

- 标记过于复杂的函数。复杂到什么程度？您可以使用圈复杂度。尝试“超过 10 个逻辑路径”。将简单的 switch 语句算作一条路径。

#### 函数如果不能抛出异常，声明 `noexcept`

**原因**：如果预期不会抛出异常，则不能假定程序能够处理该错误，应尽快终止程序。将函数声明为 `noexcept` 通过减少备用执行路径的数量来帮助优化器。它还可以加快失败后的退出速度。

示例：将 `noexcept` 应用于完全用 C 或任何其他没有异常的语言编写的函数。C++ 标准库对 C 标准库中的所有函数都隐式执行此操作。您甚至可以在可能抛出异常的函数上使用 `noexcept`。

```cpp
vector<string> collect(istream& is) noexcept {
    vector<string> res;
    for (string s; is >> s;)
        res.push_back(s);
    return res;
}
```

如果 `collect()` 内存不足，程序就会崩溃。除非程序被精心设计为能够应对内存耗尽，否则这可能正是正确的做法；`terminate()` 可能会生成合适的错误日志信息（但内存耗尽后很难做任何巧妙的事情）。

在决定是否将函数标记为 `noexcept` 时，您必须了解代码运行的执行环境，特别是考虑到异常和分配的问题。旨在完全通用的代码（如标准库和其他此类实用代码）需要支持可以在其中有意义地处理 `bad_alloc` 异常的环境。然而，大多数程序和执行环境无法有意义地处理分配失败，而在这些情况下中止程序是对分配失败最干净、最简单的响应。如果您知道您的应用程序代码无法响应分配失败，那么即使在进行分配的函数上添加 `noexcept` 也是合适的。

换句话说：在大多数程序中，大多数函数都可能抛出异常（例如，因为它们使用了 `new`，调用了执行此操作的函数，或者使用了通过抛出异常报告失败的库函数），因此在不考虑可能发生的异常是否可以处理的情况下，不要到处乱加 `noexcept`。

`noexcept` 对频繁使用、简单低级函数最有价值（也最明确正确）。

- （困难）标记那些不 `noexcept` 但又不能抛出异常的低级函数。

- 标记那些会抛出异常的 `swap`、`move`、析构函数和默认构造函数。

#### 对于通用函数而言，使用 `T*` 或 `T&` 传递参数

**原因**：传递智能指针会转移或共享所有权，仅应在预期所有权语义时使用。不需要操作生命周期的函数应改用原始指针或引用。通过智能指针传递会限制函数的用法，只能由使用智能指针的调用者使用。需要 `widget` 的函数应该能够接受任何 `widget` 对象，而不仅仅是那些生命周期由特定类型的智能指针管理的。

传递共享智能指针（例如 `std::shared_ptr`）会产生运行时开销。

示例：

```cpp
// accepts any int*
void f(int*);

// can only accept ints for which you want to transfer ownership
void g(unique_ptr<int>);

// can only accept ints for which you are willing to share ownership
void g(shared_ptr<int>);

// doesn't change ownership, but requires a particular ownership of the caller
void h(const unique_ptr<int>&);

// accepts any int
void h(int&);
```

错误示例：

```cpp
// callee
void f(shared_ptr<widget>& w) {
    // ...
    use(*w); // only use of w -- the lifetime is not used at all
    // ...
};

// caller
shared_ptr<widget> my_widget = /* ... */;
f(my_widget);

widget stack_widget;
f(stack_widget); // error
```

正确示例：

```cpp
// callee
void f(widget& w) {
    // ...
    use(w);
    // ...
};

// caller
shared_ptr<widget> my_widget = /* ... */;
f(*my_widget);

widget stack_widget;
f(stack_widget); // ok -- now this works
```

- （简单）当一个通过值传递的智能指针类型的参数（重载了 `operator->` 或 `operator*`）是可复制的，但函数仅调用 `operator*`、`operator->` 或 `get()` 中的任何一个时，应发出警告。建议改用 `T*` 或 `T&`。

- 标记一个智能指针类型的参数（一个重载了 `operator->` 或 `operator*` 的类型），该参数是可复制/可移动的，但在函数体中从未被复制/移动过，并且从未被修改过，也没有被传递给可能这样做的另一个函数。这意味着所有权语义未被使用。建议改用 `T*` 或 `T&`。

#### 优先使用纯函数

**原因**：纯函数更容易推理，有时更容易优化（甚至并行化），有时可以进行记忆化。

示例：

```cpp
template<class T>
auto square(T t) { return t * t; }
```

#### 优先使用简单和惯用的信息传递方式

**原因**：使用“不寻常且巧妙”的技术会引起意外，减慢其他程序员的理解速度，并鼓励错误。如果您确实觉得需要超出常用技术的优化，请进行测量以确保它确实是一种改进，并进行文档/注释，因为改进可能不具有可移植性。

普通参数传递：

![图片.png](/assets/feishu/cpp-python-code-style/fig-01.webp)

高级参数传递：

![图片.png](/assets/feishu/cpp-python-code-style/fig-02.webp)

#### 要返回多个“输出”值，优先使用结构体

原因：请注意，C++ 确实有多个返回值，通过约定使用类似元组的类型（`struct`、`array`、`tuple` 等），可能还具有调用站点上的结构化绑定（C++17）的额外便利性。如果可能，优先使用命名的 `struct`。否则，`tuple` 在变长模板中很有用。

示例：

```typescript
// BAD: output-only parameter documented in a comment
int f(const string& input, /*output only*/ string& output_data) {
    // ...
    output_data = something();
    return status;
}

// GOOD: self-documenting
struct f_result { int status; string data; };

f_result f(const string& input) {
    // ...
    return {status, something()};
}
```

- 输出参数应被返回值替换。输出参数是函数写入、调用非 `const` 成员函数或作为非 `const` 对象传递的参数。

- `pair` 或 `tuple` 返回类型应尽可能被 `struct` 替换。在变长模板中，`tuple` 常常是不可避免的。

#### 当“无参数”是一个有效选项时，优先使用 `T*` 而不是 `T&`

**原因**：指针（`T*`）可以是 `nullptr`，而引用（`T&`）则不能，没有有效的“空引用”。有时将 `nullptr` 作为“无对象”的替代表示很有用，但如果不是，引用在表示法上更简单，并且可能产生更好的代码。

示例：

```typescript
string zstring_to_string(zstring p) {
// zstring is a char*; that is a C-style string
    if (!p) return string{};    // p might be nullptr; remember to check
    return string{p};
}

void print(const vector<int>& r) {
    // r refers to a vector<int>; no check needed
}
```

虽然不是有效的 C++，但有可能构造一个本质上是 `nullptr` 的引用（例如 `T* p = nullptr; T& r = *p;`）。这种错误非常罕见。如果您倾向于使用指针表示法（`->` 和/或 `*` 而不是 `.`），`not_null<T*>` 提供与 `T&` 相同的保证。

#### 避免在将在非局部使用（包括返回、存储在堆上或传递给另一个线程）的 lambda 中通过引用捕获

**原因**：指向局部的指针和引用不应超出其作用域。通过引用捕获的 lambda 只是存储局部对象引用的另一种方式，如果不希望它们（或其副本）超出作用域，则不应这样做。

错误示例：

```cpp
int local = 42;

// Want a reference to local.
// Note that after program exits this scope,
// local no longer exists, therefore
// process() call will have undefined behavior!
thread_pool.queue_work([&] { process(local); });
```

良好示例：

```cpp
int local = 42;
// Want a copy of local.
// Since a copy of local is made, it will
// always be available for the call.
thread_pool.queue_work([=] { process(local); });
```

- （简单）当捕获列表包含对本地声明变量的引用时，发出警告。

- （复杂）当捕获列表包含对本地声明变量的引用，并且 lambda 被传递给非 `const` 的非局部上下文时，标记。

---

### C++ 技巧和最佳实践

#### 代码中直接表达思想

**原因**：编译器不会阅读评论(或设计文档),许多程序员(通常)也不会阅读。 代码中表达的内容定义了语义,原则上可以由编译器和其他工具进行检查。

示例：

```cpp
class Date {
public:
    Month month() const;  // 好
    int month();          // 不好
    // ...
};
```

第一个接口明确返回值为 `Month`类型，并且不会修改 `Date` 对象的状态，第二个接口需要让用户需要猜测返回数据的类型，并且没有约束相关行为，即可能存在接口内修改对象状态的情况，这可能会引入副作用。

示例（bad）：这个循环是 `std::find` 的一种受限形式

```cpp
void f(vector<string>& v) {
    string val;
    cin >> val;
    // ...
    int index = -1;                    // 不好, 可以使用 gsl::index
    for (int i = 0; i < v.size(); ++i) {
        if (v[i] == val) {
            index = i;
            break;
        }
    }
    // ...
}
```

示例（good）：更清晰的意图表达方式应该是

```typescript
void f(vector<string>& v) {
    string val;
    cin >> val;
    // ...
    auto p = find(begin(v), end(v), val);  // 这样更好
    // ...
}
```

一个设计良好的库能够比直接使用语言特性更好地表达意图（要做什么，而不仅仅是如何做）。

示例：

```cpp
change_speed(double s);    // 不好: s 是什么含义？单位是什么？
// ...
change_speed(2.3);
change_speed(Speed s);     // 更好: s 的含义被明确，同时具备
// ...
change_speed(2.3);         // 错误: 没有单位
change_speed(23_m / 10s);  // 这样是最好的，但需要自定义字面量
```

我们可以接受一个普通的（无单位的） `double` 浮点数作为增量，但这很容易出错。如果我们既需要绝对速度又需要增量，我们就应该定义一个 `Delta` 类型。

总结：

- 始终使用 `const` （检查成员函数是否修改其对象；检查函数是否修改通过指针或引用传递的参数）

- 标记类型转换的使用（类型转换会使类型系统中性）

- 检测模仿标准库的代码（难度较高）

#### 使用 ISO 标准 C++ 编写

**原因**：通常而言，编译器实现会支持 ISO 标准的同时带有一定自定义的拓展，为了确保代码的一致性，需要限制代码可使用的标准范围（或是指定编译器，但这可能造成移植性问题）。

- 在某些情况下，扩展程序是必要的，例如访问系统资源。在这种情况下，应将必要的扩展程序的使用限制在特定区域，并使用非核心编码规范来控制它们的使用。如果可能，应构建封装扩展程序的接口，以便在不支持这些扩展程序的系统上禁用它们或将其编译移除。扩展通常缺乏严格定义的语义。即使是常见的、被多个编译器实现的扩展，也可能由于*缺乏*严格的标准定义而表现出略微不同的行为和极端情况。如果大量使用此类扩展，预期的可移植性将会受到影响。

- 在某些情况下，必须限制标准 C++ 语言或库功能的使用，例如，为了避免飞控软件标准要求的动态内存分配。在这种情况下，应根据具体环境，对这些编码指南进行扩展，以控制其使用（或禁用）。

> 使用最新的 C++ 编译器（当前为 C++17），必要时设置不接受扩展的选项。

#### 表达意图

**原因**：除非明确说明代码的意图（例如，在名称或注释中），否则无法判断代码是否执行了它应该执行的操作。

示例：

```cpp
// 正常
gsl::index i = 0;
while (i < v.size()) {
    // ... 操作 v[i] ...
}
// 这里并未明确说明“仅仅”遍历 v 的元素的意图。
// 索引的实现细节被暴露出来（因此可能被误用），
// 而且 i 生命周期超过了循环的作用域，这是否是预期行为尚不确定。读者仅凭这段代码无法判断。

// 更好
for (const auto& x : v) { /* 仅对 v 中元素进行操作 */ }

// 现在，代码中没有明确提及迭代机制，
// 而且循环操作的是 const 元素的引用，因此不会发生意外修改。
// 如果需要修改，请明确说明：
for (auto& x : v) { /* 修改 x */ }
```

有时，使用命名算法会更好。如 `for_each` ，因为它直接表达了意图：

```cpp
for_each(v, [](int x) { /* 对 x 的值进行操作 */ });
for_each(par, v, [](int x) { /* 对 x 的值进行操作 */ });
```

第二个代码明确表明，我们对 `v` 的元素的处理顺序不感兴趣。

程序员应该熟悉：

- [ISO C++ 标准库](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#sl-the-standard-library)

- 当前项目使用的任何基础库

#### 理想情况下，程序应该是静态类型安全的

**原因**：理想情况下，程序应该完全静态（编译时）类型安全，但这是不可能的。

**问题**：

- unions 联合体：类型系统无法静态验证“当前存的是什么”。

- casts 类型转换：类型转换允许你绕过类型系统，当使用了错误的转换时，可能存在问题。

- array decay：数组退化，指数组类型退化为指针的情况，指针丢失了长度信息，可能导致数组索引越界。

- range errors ：C++ 不强制进行索引范围检查，比如 vector，可以通过 .at 函数进行运行时索引范围检查，但是无法做到静态检查。

- narrowing conversions：该转换丢失信息，可能存在精度丢失、溢出、截断等问题。

对于这些问题，C++ 提供了一些解决方案：

- unions：使用 `variant` （C++ 17 支持）。

- casts：减少使用，某些情况下可以用模板来实现对不同类型的支持。

- array decay：不要使用原始数组，尽量使用 STL 容器。

- range errors：使用 `span`（来自 GSL）。

- narrowing conversions：尽量减少使用，并在必要时使用 `narrow` 或 `narrow_cast` （来自 GSL）。

#### 优先选择编译时检查而非运行时检查

**原因**：代码清晰且性能优异。无需为编译时捕获的错误编写错误处理程序。编译时无法检查的内容应该在运行时可以检查。

示例：

```cpp
// Int 是整数的别名
int bits = 0;         // 以下是没有必要的特判
for (Int i = 1; i; i <<= 1) {
    ++bits;
}
if (bits < 32) {
    cerr << "Int too small\n";
}
```

这个例子未能达到预期目的（因为 overflow 未定义），应该用简单的 `static_assert` 替换：

```cpp
// Int 是整数的别名
static_assert(sizeof(Int) >= 4);    // 让检查在编译期进行
```

或者更好的办法是直接使用类型系统，将 `Int` 替换为 `int32_t` 。

使用 `assert` 时请注意编译模式，DEBUG 模式和 RELEASE 模式存在不同行为。

#### 尽早捕获运行时错误

**原因**：避免出现“莫名其妙”的崩溃。避免因错误导致（可能无法识别的）错误结果。

示例：

```cpp
void increment1(int* p, int n) {    // 不好：容易出错
    for (int i = 0; i < n; ++i) ++p[i];
}

void use1(int m) {
    const int n = 10;
    int a[n] = {};
    // ...
    increment1(a, m);   // 可能是笔误，也可能是 m <= n 的写法
                        // 但假设 m == 20
    // ...
}
```

这里我们在 `use1` 中犯了一个小错误，会导致数据损坏或程序崩溃。(指针，计数) 式的接口使得 `increment1()` 函数无法有效地防止越界错误。如果我们尝试检查下标是否存在越界访问，那么直到访问 `p[10]` 时才会发现这个错误。我们可以更早地进行检查并改进代码：

```cpp
void increment2(span<int> p) {
    for (int& x : p) ++x;
}

void use2(int m) {
    const int n = 10;
    int a[n] = {};
    // ...
    increment2({a, m});    // 可能是笔误，也可能是 m <= n 的写法
    // ...
}
```

现在，可以在调用点（早期）检查 `m <= n` 而不是稍后检查。如果只是笔误，导致我们本意是使用 `n` 作为边界，那么代码可以进一步简化（从而消除出错的可能性）：

```cpp
void use3(int m) {
    const int n = 10;
    int a[n] = {};
    // ...
    increment2(a);   // 元素的数量不必重复
    // ...
}
```

示例：bad，不要重复检查同一个值。不要将结构化数据作为字符串传递

```typescript

Date read_date(istream& is);    // 从 istream 读取日期

Date extract_date(const string& s);    // 从字符串中提取日期

void user1(const string& date) {
    auto d = extract_date(date);
    // ...
}

void user2() {
    Date d = read_date(cin);
    // ...
    user1(d.to_string());
    // ...
}
```

日期经过两次验证（通过 `Date` 构造函数），并以字符串（非结构化数据）的形式传递。

示例：bad

过多的检查会造成高昂的成本。有些情况下，过早检查效率低下，因为你可能永远不需要该值，或者只需要其中的一部分，而这部分值比全部值更容易检查。同样地，不要添加会改变接口渐近行为的有效性检查（例如，不要向平均复杂度为 `O(1)` 的接口添加 `O(n)` 检查）

```cpp
class Jet {    // 物理上一定符合 e * e < x * x + y * y + z * z
    float x;
    float y;
    float z;
    float e;
public:
    Jet(float x, float y, float z, float e)
        :x(x), y(y), z(z), e(e) {
        // 我应该在这里检查一下这些数值是否具有物理意义吗？
    }

    float m() const {
        // 我应该处理这个特殊案例吗？
        return sqrt(x * x + y * y + z * z - e * e);
    }

};
```

喷气式飞行器的物理定律（$e^2 < x^2 + y^2 + z^2$）并不是一个不变式，但是因为测量误差的存在可能使其无法始终成立。这会导致即使理想情况下 `sqrt` 能正常工作，但由于现实测量误差等原因，可能出现意外情况，对于浮点数要特别注意误差情况。

#### 不要泄露任何资源

**原因**：即使资源增长缓慢，随着时间的推移，这些资源也会耗尽。这一点对于长期运行的程序尤为重要，也是负责任的编程行为中不可或缺的一部分。

示例：bad

```cpp
void f(const char* name) {
    FILE* input = fopen(name, "r");
    // ...
    if (something) return;   // 不好：如果某个条件为真，则文件句柄泄漏
    // ...
    fclose(input);
}
```

更好的是 RAII：为了避免内存泄漏和手动资源管理的复杂性，C++ 语言强制执行的构造函数/析构函数对称性，与资源获取/释放函数对（例如 `fopen` / `fclose` 、 `lock` / `unlock` 和 `new` / `delete` 固有的对称性相呼应。每当您处理需要成对调用获取/释放函数的资源时，请将该资源封装在一个强制执行成对调用的对象中——在其构造函数中获取资源，并在其析构函数中释放资源。

如果某个资源“行为异常”（即它没有被表示为带有析构函数的类），则应将其包装在一个类中或使用 `finally`。

#### 不要浪费时间和空间

**原因**：这是 C++。

示例：bad

```cpp
struct X {
    char ch;
    int i;
    string s;
    char ch2;

    X& operator=(const X& a);
    X(const X&);
};

X waste(const char* p) {
    if (!p) throw Nullptr_error{};
    int n = strlen(p);
    auto buf = new char[n];
    if (!buf) throw Allocation_error{};
    for (int i = 0; i < n; ++i) buf[i] = p[i];
    // ... 操纵缓冲区 ...
    X x;
    x.ch = 'a';
    x.s = string(n);    // 给 x.s 留出空间 *p
    for (gsl::index i = 0; i < x.s.size(); ++i) x.s[i] = buf[i];  // 将缓冲区复制到 x.s
    delete[] buf;
    return x;
}

void driver() {
    X x = waste("Typical argument");
    // ...
}
```

这只是个夸张的例子，但在生产代码中确实存在类似的错误，甚至更糟。注意， `X` 的布局保证了至少 6 个字节（很可能更多）被浪费。对复制操作的错误定义禁用了移动语义，导致返回操作速度很慢（请注意，这里无法保证返回值优化，即 RVO）。使用 `new` 和 `delete` 来处理 `buf` 是多余的；如果真的需要一个局部字符串，就应该直接使用局部 `string` 。此外，还有许多其他性能问题和不必要的复杂性。

考虑可见性和作用范围可以帮助我们更好地理解这个实践技巧，应当在大部分将变量作用范围限定在函数内部，使用 `static` 和 `const` 是必要的，过重的构造函数不应当反复初始化（除非这是必要的）。

#### 优先选择不可变数据而非可变数据

**原因**：处理常量比处理变量更容易。不可变的事物不会发生意外变化。有时，不可变性有助于实现更好的优化。常量上不会出现数据竞争。

保持5个规范即可：

1. 默认情况下，对象是不可变的：

    ```cpp
    for (const int i : c) cout << i << '\n';    // 好： 只读，const

    for (int i : c) cout << i << '\n';          // 不好: 只读，但未加上 const
    ```

    例外：如果局部变量按值返回且移动比复制更便宜，则不应声明为 `const` 因为它可能会强制进行不必要的复制。

    ```cpp
    std::vector<int> f(int i) {
        std::vector<int> v{ i, i, i };  // const 不是必要的，这；里有 RVO 优化
        return v;
    }
    ```

    通过值传递的函数参数很少会被修改，但也很少被声明为 `const` 。为了避免混淆和大量的误报，不要对函数参数强制执行此规则。

2. 默认情况下，将成员函数设为 `const`

    除非成员函数会改变对象的可观察状态，否则应该将其标记为 `const` 。这样做可以更精确地表达设计意图，提高代码可读性，让编译器捕获更多错误，有时还能带来更多优化机会。

    示例：bad

    ```cpp
    class Point {
        int x, y;
    public:
        int getx() { return x; }    // 不好：应该设为常量，因为它不会修改对象的状态
        // ...
    };

    void f(const Point& pt) {
        int x = pt.getx();          // 错误：编译失败，因为 getx 未标记为 const
    }
    ```

3. 默认情况下，将指针和引用传递给 `const`

    为了避免被调用函数意外地改变值。当被调用函数不修改状态时，程序更容易理解。

    ```cpp
    void f(char* p);        // f 是否会修改 *p？（我们需要假设会）
    void g(const char* p);  // g 不修改 *p
    ```

4. 使用 `const` 定义构造后值不会改变的对象

    防止因对象值意外更改而导致的意外情况。

    示例：

    ```cpp
    void f() {
        int x = 7;
        const int y = 9;

        for (;;) {
            // ...
        }
        // ...
    }
    ```

    由于 `x` 不是 `const` ，我们必须假设它在循环中的某个地方被修改了。

5. 对于可以在编译时计算的值，请使用 `constexpr`

    性能更佳，编译时检查更完善，保证编译时评估，不会出现竞态条件。

    示例：

    ```cpp
    double x = f(2);            // 可能在运行时执行
    const double y = f(2);      // 可能在运行时执行
    constexpr double z = f(2);  // 除非 f(2) 可以在编译时求值，否则会出错
    ```

#### 将混乱的结构封装起来，而不是散布在代码各处

原因：混乱的代码更容易隐藏 bug，而且编写起来也更困难。一个好的界面使用起来更方便、更安全。混乱的底层代码会滋生更多类似的代码。

示例 bad：

```cpp
int sz = 100;
int* p = (int*) malloc(sizeof(int) * sz);
int count = 0;
// ...
for (;;) {
    // ... 将一个整数读入 x，如果到达文件末尾则退出循环 ...
    // ... 检查 x 是否有效 ...
    if (count == sz)
        p = (int*) realloc(p, sizeof(int) * sz * 2);
    p[count++] = x;
    // ...
}
```

这种方法底层、冗长且容易出错。例如，我们“忘记”测试内存耗尽情况并为 `sz` 赋新值。相反，我们可以使用 `vector` ：

```cpp
vector<int> v;
v.reserve(100);
// ...
for (int x; cin >> x; ) {
    // ... 检查 x 是否有效 ...
    v.push_back(x);
}
```

#### 酌情使用辅助工具和支持库

**原因**：很多事情用现有工具会做会更好。比如使用 代码静态分析器，验证你的代码是否符合你希望它遵循的准则。使用格式化工具，保证代码符合编码格式，1.8节会提供 clang-format 和 clang-tidy 文件用于检查代码格式和规范。1.7节会提供一份CMake模板，其中包含了各类消毒水的启动选项。

---

### 命名约定和注释

几种命名方式：

- 大驼峰

- 小驼峰

- 小写 + 下划线

- 全大写 + 下划线

- 不强制命名格式（常量命名可能存在 k开头 + 其他命名规范）

```cpp
// 相关命名内容用绿色背景标注

// 大驼峰
class RobotController;
// 小驼峰
RobotController::update();
RobotController::registerRobot();
// 小写 + 下划线
auto robot_controller_ptr = std::make_unique<RobotController>();
// 全大写 + 下划线
static constexpr auto ROBOT_CONTROLLER_XXX_DATA = 100;
// 不强制命名格式
static constexpr auto kRobotXXXData = 100;
```

#### 类型命名

- 类型命名（class、struct）使用 **大驼峰**

示例：

```cpp
class RobotController;
struct RobotControllerData;
```

#### 变量命名

- 局部变量使用 **小写 + 下划线**

- 私有成员变量使用 **小写 + 下划线风格 必须 以下划线结尾**

- 静态常量 **不强制命名格式**

- `constexpr` 变量使用 **全大写 + 下划线**

- Enum 变量使用 **全大写 + 下划线**

示例：

```cpp
// constexpr 变量
constexpr auto ROBOT_DEFAULT_JOINT_SIZE = 23;

enum class RobotType {
    TYPE1,
    TYPE2
};

class Robot {
 public:
    void update() {
        // 静态常量（通常视作用范围定，此处与局部变量一致）
        static const auto k_robot_name = "xxx";
        // 局部变量
        const auto joint_size =  joint_index_vec_.size();
        // ...
    }
 private:
    // 私有成员变量
    std::vector<int> joint_index_vec_;
    double target_velocity_;
};
```

#### 函数命名

- 函数参数使用 **小写下划线**

- `Public` 方法使用 **小驼峰**

- `Protected`* *方法使用 **小驼峰**

- `Private`* *方法使用 **小驼峰**

- 全局函数使用 **大驼峰**

示例：

```cpp
class FSMBase {
   public:
       bool changeState(int id);
   protected:
       std::string getNowStateName();
   private:
       bool execRun();
};

FSMBase* InitFSM();
```

#### 其他命名

- 命名空间命名使用 **小写下划线**

- 模板参数命名使用 **大驼峰**

- 宏定义命名使用 **大写下划线**

示例：

```cpp
#ifndef SPDLOG_ACTIVE_LEVEL
#define SPDLOG_ACTIVE_LEVEL SPDLOG_LEVEL_TRACE
#endif

namespace robot {
namespace infra {
namespace log {

#define ROBOT_INFO(...)                                                 \
    do {                                                               \
        robot::infra::log::EnsureInitialized();                          \
        SPDLOG_LOGGER_INFO(robot::infra::log::robot_logger, __VA_ARGS__); \
    } while (0)

template <typename... Args>
void Infoout(const std::string& fmt, const Args&... args) {
    EnsureInitialized();
    robot_logger->info(fmt, args...);
}

}*  // namespace log*
}*  // namespace infra*
}*  // namespace robot*
```

---

### CMake 相关模板

其中包含了项目结构目录，基础的 CMakeLists.txt 和 常用的 CMake 函数封装。以及测试模板。

> 其中 examples 需要通过 make install 安装项目后才能正常编译，默认安装路径为 /opt/little_robot，在cmake/option.cmake 中可关闭编译 example 。之后每次更新库都需要重新安装才能使 examples 使用的库实现改变。

---

### 代码格式及相关检查工具

#### 配置文件

使用 clang-tidy 进行代码静态检查，clang-format 进行格式化，cmake-format进行 CMake格式化，以下是配置文件。

#### 如何在 Vscode 中使用

1. 先将配置文件拷贝到项目根目录下

2. 系统安装如下依赖（以Ubuntu为例）

```text
sudo apt install clang-tidy clang-format cmake-format
```

3. Vscode 安装插件

![image.png](/assets/feishu/cpp-python-code-style/fig-03.webp)

![image.png](/assets/feishu/cpp-python-code-style/fig-04.webp)

![image.png](/assets/feishu/cpp-python-code-style/fig-05.webp)

4. 格式化快捷键：Ctrl + Shift + I

5. Clang-tidy 会在错误代码（警告）中标注

#### 临时禁用格式化

在代码中添加以下注释可临时禁用格式化：

```cpp
// clang-format off
// 这里的代码不会被格式化
void unformatted_code() {
}
// clang-format on
```

---

## Python 代码规范

C++ 那套规范的核心是「正确性优先」，Python 这边要额外加一条：**可读性优先于技巧**。
Python 的语法糖很多，但工程代码是写给下一个接手的人看的。

### 格式与命名

- 一律 **4 空格缩进**，不要 Tab；行宽上限 100 字符（PEP 8 的 79 对现代屏幕太窄，
  内部的 C++ 侧用到 120，这里取 100 作为折中）。
- `snake_case` 给函数、变量、模块；`CapWords` 给类；`UPPER_CASE` 给模块级常量。
- 前导下划线表示内部：`_helper()` 是模块内部函数。`__x` 那种双下划线会触发名字改写，
  工程代码里几乎不需要它，只会让调试和序列化变麻烦。
- 格式化交给 [Ruff](https://docs.astral.sh/ruff/)（或 Black），静态检查也用 Ruff。
  不要为「谁的空格更对」在 review 里争论，让工具决定。

### 类型标注

公开函数**必须**标注参数与返回值：

```python
def solve_ik(target: np.ndarray, seed: np.ndarray, *, max_iter: int = 200
             ) -> tuple[np.ndarray, bool]:
    """解单腿逆运动学。返回 (关节角, 是否收敛)。"""
```

- 用 `from __future__ import annotations`，这样 3.8+ 都能直接写 `list[int]`。
- 用 `mypy` 或 `pyright` 真的跑一遍。标注不检查就只是注释，过半年没人敢改。
- **不要用可变对象做默认值**。`def f(a=[])` 里那个列表在所有调用之间共享，
  是 Python 里最经典的一类「昨天还好好的」bug。默认值写 `None`，在函数体里建。

### 异常与资源

- 只捕获**你确实知道怎么处理**的异常。裸 `except:` 连 `KeyboardInterrupt` 和
  `SystemExit` 一起吞掉，Ctrl-C 都停不下来。
- 抛异常要带现场：`raise ValueError(f"关节数不匹配: 期望 {n_dof}, 实际 {q.size}")`，
  而不是 `raise ValueError("bad input")`。
- 文件、串口、socket 一律用 `with`；需要自己管生命周期就用 `contextlib.contextmanager`。
- 不在 `finally` 里 `return` —— 它会静默吞掉正在传播的异常。

### 数值与并发

- 浮点比较不要用 `==`，用 `math.isclose(a, b, rel_tol=1e-9)`。
- 用 numpy 时注意**视图与副本**：`a[1:3]` 是视图，`a[[1,2]]` 是副本，
  `reshape` 在内存不连续时会悄悄复制。对同一块数据既读又写时先 `.copy()` 写清意图，
  比事后查「为什么结果不对」便宜得多。
- 多线程受 GIL 限制：CPU 密集用 `multiprocessing`，或把重活交给 numpy / C++ 扩展；
  只有 I/O 密集才用线程。异步代码里不要调用阻塞函数，要阻塞就 `run_in_executor`。
- 与控制回路交互的 Python 只做配置、可视化和离线分析，
  **不要**把它放进 1 kHz 的环路 —— 一次 GC 就够丢掉好几帧。

### 工程约定

- 每个包一个 `__init__.py`，公开接口在那里用 `__all__` 显式导出，
  不要把内部模块全漏出去。
- 依赖写在 `pyproject.toml` 里并加上下界。机器人项目最怕「同事机器上能跑」，
  而原因是某个库的次版本号不同。
- 路径、IP、标定参数走配置文件或环境变量，不要硬编码。
- 日志用 `logging` 而不是 `print`。**库代码里不要调 `basicConfig`、不要加 handler** ——
  那是应用层的事；库一配，用的人就没法决定自己的日志去哪儿。

---

## 操作系统/架构 平台相关注意事项

### 总体原则

1. 不假设操作系统类型

2. 不假设 CPU 架构

3. 不假设字节序

4. 不假设指针大小

5. 不依赖未定义行为

最好要做到：同一份源码可在不同平台编译。
