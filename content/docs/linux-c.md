---
title: 尝试在 Linux 上编写 C 程序
slug: linux-c
tags: [C, Linux, gcc, 视觉组教程]
summary: 完成编译、链接、调试与检查的最小闭环，认识退出码、编译警告和常见内存错误。
order: 2
collection: windows-to-linux
origin: "https://github.com/luoyebai/doc_html/blob/HEAD/视觉组教程/从Windows到Linux/Linux上的C/main.md"
---

# 在 Linux 下编写 C 程序


--

前置：能使用终端、创建文件。环境：Ubuntu / Debian，GCC 或 Clang。


--

本课完成一个独立程序，并能解释它从源码到执行的过程。

----
## 准备工具


--

```bash
sudo apt update
sudo apt install build-essential gdb
mkdir -p "$HOME/c-practice"
cd "$HOME/c-practice"
cc --version
```


--

安装软件需要管理员权限；创建源文件、编译和运行练习使用普通用户即可。

----
## 第一个程序


--

保存为 `hello.c`：


--

```c
#include <stdio.h>

int main(void) {
    puts("Hello, C!");
    return 0;
}
```


--

```bash
mkdir -p build
cc -std=c17 -Wall -Wextra -Wpedantic -g hello.c -o build/hello
./build/hello
printf 'exit status: %s\n' "$?"
```


--

预期输出问候语，退出码为 0。构建产物放入 `build/`，源文件继续保留。

----
## 从源码到可执行文件


--

<!--fig:build-flow-->


--

预处理展开头文件与宏；编译形成汇编表示；汇编产生目标文件；链接解析符号并组合程序。


--

```bash
cc -E hello.c -o build/hello.i
cc -S hello.c -o build/hello.s
cc -c hello.c -o build/hello.o
cc build/hello.o -o build/hello
```


--

日常 `cc hello.c -o build/hello` 会串起这些步骤。

----
## 声明、定义与链接


--

`sum.h` 声明接口：


--

```c
#ifndef SUM_H
#define SUM_H
int sum(int a, int b);
#endif
```


--

`sum.c` 包含该头文件并定义函数：`int sum(int a, int b) { return a + b; }`。
`main.c` 包含头文件后调用 `sum(2, 3)`。


--

```bash
cc -std=c17 -Wall -Wextra main.c sum.c -o build/sum-demo
```


--

头文件不是“把库安装进程序”；如果漏编译 `sum.c`，链接器仍会报告未定义的符号。

----
## 按错误阶段定位


--

| 阶段 | 例子 | 方向 |
|---|---|---|
| 编译 | 缺分号、类型不匹配 | 查看第一条诊断与源码位置 |
| 链接 | `undefined reference` | 是否提供定义、链接对应库 |
| 加载 | 找不到共享库 | 安装布局与运行时搜索路径 |
| 运行 | 崩溃、错误输出 | 输入、状态、边界与生命周期 |


--

先读最早的错误；后续几十条可能只是同一个错误引起的连锁反应。

----
## 用断点观察程序


--

```bash
gdb ./build/hello
```


--

进入 GDB 后：


--

```text
break main
run
next
backtrace
continue
quit
```


--

编译时使用 `-g` 保留调试信息；优化可能让变量或语句位置不再直观，初学可以先用 `-O0`。

----
## 检查边界与内存


--

```bash
cc -std=c17 -Wall -Wextra -g -O1 \
  -fsanitize=address,undefined hello.c -o build/hello-check
./build/hello-check
```


--

AddressSanitizer 帮助检测越界、释放后使用等错误；UBSan 检测部分未定义行为。


--

没有报告不代表不存在错误；工具只检查实际执行到的路径，并且各平台支持不同。

----
## 给函数加可执行的约定


--

```c
#include <assert.h>
#include <stddef.h>
int sum_small(const int *a, size_t n) {
    int total = 0;
    for (size_t i = 0; i < n; ++i) total += a[i];
    return total;
}
int main(void) {
    int values[] = {2, -1, 4};
    assert(sum_small(values, 3) == 5);
    assert(sum_small(NULL, 0) == 0);
    return 0;
}
```


--

本例约定每次累加都在 `int` 可表示范围内；面向任意外部输入时还要检查溢出。
`assert` 可被 `NDEBUG` 禁用，不能替代输入校验。

----
## 练习与参考


--

把求和函数拆到 `sum.c` / `sum.h`，测试程序放在 `test_sum.c`。


--

验收：能分别编译目标文件、链接测试程序，空数组与混合正负数样例通过，警告清零。


--

```bash
cc -std=c17 -Wall -Wextra -g -c sum.c -o build/sum.o
cc -std=c17 -Wall -Wextra -g test_sum.c build/sum.o -o build/test_sum
./build/test_sum
```


--

参考：[GCC 编译选项](https://gcc.gnu.org/onlinedocs/gcc/Overall-Options.html)、[GDB 手册](https://sourceware.org/gdb/current/onlinedocs/gdb.html/)、[Clang AddressSanitizer](https://clang.llvm.org/docs/AddressSanitizer.html)。
