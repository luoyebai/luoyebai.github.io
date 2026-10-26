---
title: 从指针来理解程序的执行
slug: pointers
tags: [C, 指针, 内存, 视觉组教程]
summary: 从地址与生命周期出发，正确理解数组、指针运算、动态内存和函数参数，避开未定义行为。
order: 3
collection: windows-to-linux
origin: "https://github.com/luoyebai/doc_html/blob/HEAD/视觉组教程/从Windows到Linux/从指针来理解程序的执行/main.md"
---

# 指针：地址之外还有边界


--

环境：C17，GCC 或 Clang；示例使用标准 C，工具命令以 Linux 为例。


--

目标：知道一个指针指向什么、可访问多大范围、对象什么时候失效。

----
## 取地址与解引用


--

```c
#include <stdio.h>
int main(void) {
    int value = 42;
    int *p = &value;
    *p = 43;
    printf("%d\n", value);
    printf("%p\n", (void *)p);
    return 0;
}
```


--

`&value` 得到地址，`*p` 访问对应对象。`int *` 还告诉编译器如何解释访问的类型。
指针的位数不等于所指对象的大小；不要假定所有平台都使用 64 位指针。

----
## 内存布局是帮助理解的模型


--

<!--fig:memory-layout-->


--

进程通常有代码、静态存储、栈和动态分配区域；具体地址、增长方向与布局依赖平台。


--

C 语言规定对象的存储期和访问规则，不保证某个局部变量一定放在某个栈地址。


--

知道一个数字“看起来像地址”，不代表程序有权通过它访问对象。

----
## 数组不等于指针


--

```c
int a[3] = {10, 20, 30};
int *p = a;             /* 此处数组转换为首元素指针 */
size_t bytes = sizeof a; /* 3 * sizeof(int) */
```


--

数组拥有连续的元素存储；指针变量保存指针值。


--

在 `sizeof a` 和 `&a` 等语境中，数组不会转换为首元素指针。
`&a` 的类型是“指向含 3 个 int 的数组的指针”，不是 `int *`。


--

使用 `size_t` 时包含 `<stddef.h>`，或提供它的其他标准头。

----
## 指针运算必须留在同一个数组范围


--

<!--fig:pointer-array-->


--

```c
int a[3] = {10, 20, 30};
int *p = a;
int *end = a + 3;       /* 可以形成尾后指针 */
for (; p != end; ++p) {
    printf("%d\n", *p); /* 只解引用有效元素 */
}
```


--

尾后指针可用于比较与循环终止，**不能解引用**。`a + 4` 本身就越过允许的运算范围。
对独立 `int x`，`&x + 1` 可形成尾后指针，但 `*(&x + 1)` 不合法。

----
## 越界不是“没碰到保护页就没事”


--

数组越界属于未定义行为：语言不规定程序此后必须怎样运行。


--

- 有时崩溃，有时输出看似正常，有时优化后出现不同结果。

--

- 栈保护、操作系统页权限和地址消毒器是检测手段，不会让越界变成合法。

--

- 加上无限循环或关闭优化，也不能修复越界。


--

```bash
cc -std=c17 -Wall -Wextra -g -O1 \
  -fsanitize=address,undefined example.c -o example
./example
```


--

这些工具不能发现所有错误，仍需检查长度和生命周期。

----
## 指针有效性依赖对象生命周期


--

```c
/* 错误示意：不能返回局部对象的地址 */
int *bad(void) {
    int temporary = 7;
    return &temporary;
}
```


--

函数结束后，该对象的生命周期结束，保存的地址不能继续解引用。


--

其他常见失效：`free` 后使用、释放两次、`realloc` 成功后继续使用旧地址。
把一个变量赋成 `NULL`，不会自动清除其他别名中的旧地址。

----
## 动态分配：检查失败，明确归还


--

```c
#include <stdio.h>
#include <stdlib.h>
int main(void) {
    size_t n = 4;
    int *a = calloc(n, sizeof *a);
    if (a == NULL) {
        fputs("allocation failed\n", stderr);
        return 1;
    }
    a[0] = 42;
    printf("%d\n", a[0]);
    free(a);
    return 0;
}
```


--

当长度来自外部时，还要校验上限；用 `malloc(n * sizeof *a)` 前检查乘法溢出。

----
## 传数组时同时传长度


--

```c
#include <stddef.h>
void zero(int *values, size_t count) {
    for (size_t i = 0; i < count; ++i) {
        values[i] = 0;
    }
}
```


--

调用者必须保证前 `count` 个元素可写；`count == 0` 时函数不会解引用。
参数写成 `int values[]` 仍会调整为指针，不能在函数里用 `sizeof values` 推算数组长度。


--

函数只读数据时使用 `const int *`，并清楚说明是否保存传入的地址。

----
## 二级指针与函数指针


--

```c
void point_to(int **out, int *value) {
    *out = value; /* 调用者保证 out 非空；value 的生命周期由调用者管理 */
}

int twice(int x) { return 2 * x; }
int apply(int (*operation)(int), int x) {
    return operation(x); /* operation 必须指向有效函数 */
}
```


--

`int **` 可以修改调用者保存的指针；函数指针可传递行为。
类型签名必须匹配，不应通过强制转换掩盖接口不一致。

----
## 练习与参考


--

`int a[2] = {3, 5};` 下，哪些操作合法？


--

| 表达式 | 答案 |
|---|---|
| `a + 2` | 合法的尾后指针 |
| `*(a + 1)` | 合法，值为 5 |
| `*(a + 2)` | 越界解引用，未定义行为 |
| `sizeof a / sizeof a[0]` | 在这里得到元素数 2 |


--

参考：[C11 委员会草案 N1570](https://www.open-std.org/jtc1/sc22/wg14/www/docs/n1570.pdf)，6.2.4 生命周期、6.5.6 指针运算、6.7.6.3 参数调整。
