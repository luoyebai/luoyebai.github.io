---
title: 编程语言的使用
slug: shell-and-languages
tags: [Shell, C++, Python, 视觉组教程]
summary: 用 Bash 正确处理路径、引号、状态码和管道，再根据任务选择 Shell、Python 或 C++。
order: 4
collection: windows-to-linux
origin: "https://github.com/luoyebai/doc_html/blob/HEAD/视觉组教程/从Windows到Linux/编程语言的使用/main.md"
---

# Shell 与编程语言


--

本课示例使用 Bash。POSIX sh、Bash、Zsh 和 Fish 不是逐级替代关系，语法也不完全兼容。


--

目标：写出不会被空格路径或失败命令悄悄破坏的小脚本。

----
## Shell 如何找到命令


--

```bash
type cd
type printf
command -v python3
printf '%s\n' "$PATH"
```


--

命令可能是别名、函数、内建命令或 `PATH` 中的可执行文件。
包含 `/` 的路径直接指定文件；`./program` 表示当前目录下的程序，`/usr/bin/env` 是绝对路径。


--

<!--fig:shell-loop-->

----
## 引号决定参数边界


--

```bash
name='a file.txt'
printf '%s\n' "$name"   # 一个参数
printf '%s\n' '$name'   # 原样输出 $name
```


--

双引号保留变量展开但抑制通常的分词和路径名展开；单引号保留字面文本。
`"$@"` 逐个转发参数，避免把多个参数拼成一个字符串再执行。


--

不要用 `eval` 执行来自文件名、用户输入或网络的任意字符串。

----
## 变量、分支与退出码


--

```bash
#!/usr/bin/env bash
file=${1:-notes.txt}
if [[ -f "$file" ]]; then
    wc -l -- "$file"
else
    printf 'missing file: %s\n' "$file" >&2
    exit 1
fi
```


--

保存后用 `bash count.sh 'a file.txt'` 运行。
赋值的 `=` 两侧不加空格；退出码 0 通常表示成功，非零表示失败。

----
## 循环与函数


--

```bash
say_hello() {
    printf 'hello, %s\n' "$1"
}
for name in Alice 'Bob Lee'; do
    say_hello "$name"
done
```


--

Bash 提供 `for`、`while`、`until`，没有内建的 C 风格 `do ... while` 语句。
函数在当前 Shell 中执行；括号 `( ... )` 创建子 Shell 环境，变量修改不会传回父 Shell。

----
## 标准流与重定向


--

<!--fig:pipe-fd-->


--

| 描述符 | 名称 | 常见用途 |
|---|---|---|
| 0 | stdin | 输入数据 |
| 1 | stdout | 正常结果 |
| 2 | stderr | 诊断信息 |


--

`cmd > out.txt 2>&1` 把两种输出都送入文件；`cmd 2>&1 > out.txt` 先复制原 stdout，再单独改 stdout，结果不同。
`>` 截断文件，`>>` 追加；执行前确认目标文件。

----
## 管道传递数据，状态需要单独检查


--

```bash
printf 'red\nblue\nred\n' | sort | uniq -c
```


--

管道把前一个命令的 stdout 接到下一个命令的 stdin。
默认状态取最后一个命令；Bash 的 `set -o pipefail` 可让上游失败影响整个管道状态。


--

查找文件用 `find . -type f -name '*.cpp'`；不要解析 `ls` 输出来处理任意文件名。
`set -e` 有语境相关的例外，重要失败仍应显式检查。

----
## 根据任务选语言


--

| 任务 | 常见选择 | 原因 |
|---|---|---|
| 连接已有命令 | Shell | 进程与文件流操作直接 |
| 数据整理、自动化 | Python | 标准库、数据结构和生态 |
| 受限资源与底层接口 | C | 显式控制与成熟接口 |
| 大型原生系统 | C++ | 资源管理、类型与抽象工具 |


--

语言没有统一的高低排名。考虑依赖、延迟、团队维护与部署约束。

----
## Python 项目使用独立环境


--

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip --version
```


--

依赖记录在项目配置或锁定文件中；用 `python -m pip` 确保安装到对应解释器。
Windows PowerShell 的激活路径是 `.venv\Scripts\Activate.ps1`，不能直接复制 Bash 命令。

----
## 练习与答案


--

为什么 `cp $source $target` 在路径含空格时出错？


--

**答案**：未加引号的变量可能分裂为多个参数，并发生通配符展开。


--

```bash
cp -- "$source" "$target"
```


--

`--` 结束选项解析，避免以 `-` 开头的名称被解释为选项。仍需检查源目标是否符合预期。


--

参考：[Bash 手册](https://www.gnu.org/software/bash/manual/bash.html)、[Python venv](https://docs.python.org/3/library/venv.html)。
