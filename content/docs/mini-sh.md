---
title: mini_sh · 手写一个 shell
slug: mini-sh
collection: learning
order: 4
tags: [Shell, 进程, 系统调用, 从编程开始的学习]
summary: 用可下载的最小 C Shell 理解 fork、exec、wait，再区分引号解析、管道与作业控制。
---

# 写一个最小 Shell


--

目标：理解命令怎样变成进程，而不是一次实现 Bash。


--

环境：Linux / POSIX，C17 编译器。本课完整程序只支持空白分词、`cd`、`exit` 与前台外部命令。

----
## 从一个循环开始


--

<!--fig:shell-loop-->


--

```text
读入一行 → 解析参数 → 判断内建命令
                    → fork 子进程
                    → 子进程 exec 外部程序
                    → 父进程 waitpid 等待
```


--

`fork` 创建子进程；`execvp` 替换当前进程映像，成功时不返回；`waitpid` 回收子进程状态。

----
## 获取并运行完整示例


--

下载 [mini_sh.c](/assets/docs/mini-sh/code/mini_sh.c)，在文件所在目录执行：


--

```bash
cc -std=c17 -Wall -Wextra -Wpedantic -g mini_sh.c -o mini_sh
./mini_sh
```


--

交互输入 `pwd`、`cd /tmp`、`pwd`、`exit`。
预期第二次 `pwd` 显示 `/tmp`；不存在的命令应报告错误后继续接受输入。


--

这个版本没有引号、变量展开、管道、重定向或后台作业；出现这些符号会明确拒绝，不会假装支持。

----
## 父子进程分别负责什么


--

核心片段，完整错误处理见下载源码：


--

```c
pid_t child = fork();
if (child == 0) {
    execvp(argv[0], argv);
    perror(argv[0]);
    _exit(127);
}
/* 父进程先处理 fork 失败，再循环 waitpid；EINTR 时重试。 */
```


--

`argv` 最后一个元素必须为 `NULL`。
子进程执行失败用 `_exit`，避免重复刷新从父进程继承的 stdio 缓冲区。

----
## 为什么 cd 在父 Shell 中执行


--

当前工作目录属于进程。如果子进程执行 `chdir`，父 Shell 的目录不会改变。


--

因此这里的 `cd` 直接调用父进程中的 `chdir`，并检查参数数量和返回值。
`exit` 结束主循环；遇到 EOF 也应正常结束。


--

下载示例使用 `getline` 读取整行，避免固定缓冲区把一条长命令误拆为两次执行；参数过多时拒绝执行。

----
## 完整 Shell 的解析更复杂


--

```text
echo a | cat       → 管道连接两个命令
echo 'a | cat'     → 一个字符串参数
echo a\|cat        → 竖线是参数中的普通字符
```


--

词法分析与语法分析必须保留引号信息；随后按规则展开变量等内容，最后去除引号。
不能先按所有竖线切开，再尝试修补引号。


--

下面的浏览器实验只演示**空白、单双引号和反斜杠**，不实现完整 Shell 展开。

----
## 交互实验：空字符串也是参数


--

```js run
function tokenize(line) {
  const tokens = [];
  let buf = '', quote = '', started = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote === "'") {
      if (c === "'") quote = ''; else buf += c;
    } else if (c === '\\') {
      if (i + 1 === line.length) return {tokens, error: '末尾转义未完成'};
      const next = line[i + 1];
      if (!quote || ['$', '`', '"', '\\', '\n'].includes(next)) {
        i++;
        if (next !== '\n') { buf += next; started = true; }
      } else { buf += c; started = true; }
    } else if (quote) {
      if (c === quote) quote = ''; else buf += c;
    } else if (c === '"' || c === "'") {
      quote = c; started = true;
    } else if (/\s/.test(c)) {
      if (started) { tokens.push(buf); buf = ''; started = false; }
    } else { buf += c; started = true; }
  }
  if (quote) return {tokens, error: '引号未闭合'};
  if (started) tokens.push(buf);
  return {tokens};
}
for (const s of ['ls -l', 'echo "a b" ""', "echo 'a|b'", 'echo "未闭合']) {
  demo.log(s, '→', JSON.stringify(tokenize(s)));
}
```


--

第二项应保留末尾 `""` 对应的空参数；错误结果不能交给执行器。

----
## 管道需要并发启动两端


--

<!--fig:pipe-fd-->


--

1. 父进程 `pipe(fd)` 创建读端与写端。

--

2. 创建左右两个子进程，分别把写端映射到 stdout、读端映射到 stdin。

--

3. 每个进程关闭不使用的原始描述符；父进程也关闭两端。

--

4. 两个子进程都启动后，父进程才等待它们。


--

如果先等左侧结束再启动右侧，较大的输出可能填满管道而阻塞。
仍有进程持有写端时，读端不会因为某一个写进程退出就自动收到 EOF。

----
## 重定向与作业控制


--

输出文件使用 `open(path, O_WRONLY | O_CREAT | O_TRUNC, 0666)`，权限再由 umask 限制。
检查返回值后 `dup2(fd, STDOUT_FILENO)`，最后关闭原始 fd。


--

后台作业不能简单“不等待”：Shell 仍需要通过 `waitpid(..., WNOHANG)` 等方式回收子进程。
完整交互 Shell 还管理进程组、控制终端与信号；Ctrl+C 发给终端的前台进程组。


--

下载程序没有实现这些作业控制语义，不能用它替代日常 Shell。

----
## 练习与答案


--

**练习**：加入内建 `pwd`，并验证外部命令失败不会结束 Shell。


--

**答案方向**：在 fork 前识别 `pwd`，调用 `getcwd` 并检查失败；仅子进程在 `execvp` 失败后退出。


--

测试输入：`pwd` → `cd /tmp` → `pwd` → `command_that_does_not_exist` → `pwd` → `exit`。


--

参考：[POSIX Shell 命令语言](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html)、[POSIX exec](https://pubs.opengroup.org/onlinepubs/9799919799/functions/exec.html)。
