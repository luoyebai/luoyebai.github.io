---
title: 从 Python 入手
slug: python-first
collection: learning
order: 2
tags: [Python, 编程入门, 从编程开始的学习]
summary: 从虚拟环境和第一个脚本开始，理解名字与对象、函数、异常和可执行测试。
---

# 从 Python 入手


--

本课使用 Python 3。目标：写一个能运行、能解释、能验证的脚本。


--

Python 适合快速表达逻辑与调用库；实际性能取决于实现、算法、数据与底层库，不能固定宣称比 C 慢多少倍。

----
## 建立独立环境


--

Linux / macOS：


--

```bash
python3 -m venv .venv
source .venv/bin/activate
python --version
```


--

Windows PowerShell（已安装 Python 3）：


--

```powershell
py -3 -m venv .venv
.venv\Scripts\python.exe --version
```


--

可以直接使用虚拟环境的解释器，无须修改执行策略。安装依赖时使用对应的 `python -m pip`。

----
## 第一个可验证的脚本


--

保存为 `temperature.py`：


--

```python
def celsius_to_fahrenheit(celsius):
    return celsius * 9 / 5 + 32

if __name__ == '__main__':
    assert celsius_to_fahrenheit(0) == 32
    assert celsius_to_fahrenheit(100) == 212
    print(celsius_to_fahrenheit(25))
```


--

运行 `python temperature.py`，预期输出 `77.0`。
Windows 未激活环境时使用 `.venv\Scripts\python.exe temperature.py`。

----
## 类型属于对象


--

常见 CPython 实现先把源码编译为字节码，再执行；“逐行直接解释源码”并不准确。
Python 是动态类型语言，名称可以绑定到不同类型的对象。


--

```python
value = 3
value = 'three'
print(type(value))  # <class 'str'>
```


--

类型注解表达意图，普通解释器不会自动把所有注解变成运行时校验。

----
## 名字、别名与复制


--

<!--fig:py-object-->


--

```python
a = [1, 2]
b = a
b.append(3)
assert a == [1, 2, 3]
b = [9]
assert a == [1, 2, 3]
```


--

修改共享列表会被两个名字观察到；重新绑定 `b` 不会重新绑定 `a`。
`list(a)` 是浅复制，嵌套的可变对象仍可能共享。

----
## 条件、循环与函数


--

```python
def positive_values(values):
    result = []
    for value in values:
        if value > 0:
            result.append(value)
    return result

assert positive_values([-2, 0, 3, 5]) == [3, 5]
assert positive_values([]) == []
```


--

用四个空格缩进。先把输入输出约定写清楚，再决定是否改成列表推导式。

----
## 默认参数只在定义时求值


--

```python
def append_value(value, items=None):
    if items is None:
        items = []
    items.append(value)
    return items

assert append_value(1) == [1]
assert append_value(2) == [2]
```


--

把默认值写成 `items=[]` 会让多次调用共享一个列表。
本例传入现有列表时会修改它，应在接口说明中明确这一点。

----
## 从异常追到输入


--

| 异常 | 常见调查方向 |
|---|---|
| `TypeError` | 实际对象类型是否符合操作要求 |
| `ValueError` | 类型可接受，但内容不符合约定 |
| `UnboundLocalError` | 局部名称是否在读取前完成赋值 |
| `ModuleNotFoundError` | 解释器环境、模块名和安装位置 |


--

先看异常类型和消息，再沿 traceback 找到自己的代码。
拿到 `None` 可能来自遗漏 return、查找失败或明确的空结果，需要回到产生它的地方。

----
## 模块与入口


--

`.py` 文件可作为模块导入；是否使用入口判断，不决定它是不是模块。


--

```python
from temperature import celsius_to_fahrenheit
print(celsius_to_fahrenheit(-40))  # -40.0
```


--

`if __name__ == '__main__':` 让演示代码只在直接执行时运行。
普通包常用目录加 `__init__.py` 组织，命名空间包是无需该文件的另一种机制。

----
## 数值比较要表达容差


--

```python
import math
from decimal import Decimal
assert math.isclose(0.1 + 0.2, 0.3, rel_tol=1e-9, abs_tol=1e-12)
assert Decimal('0.1') + Decimal('0.2') == Decimal('0.3')
```


--

浮点容差要对应业务单位与规模；接近零时尤其要考虑绝对容差。
Decimal 也有精度上下文，不等于所有计算无限精确。比较值用 `==`，判断单例空值用 `is None`。

----
## 练习与参考


--

写一个函数把一组摄氏温度转为华氏温度，空列表返回空列表。


--

参考答案：`return [celsius_to_fahrenheit(x) for x in values]`。
验证 `[0, 100, -40] → [32.0, 212.0, -40.0]` 与 `[] → []`。


--

参考：[Python 教程](https://docs.python.org/3/tutorial/)、[venv](https://docs.python.org/3/library/venv.html)、[浮点说明](https://docs.python.org/3/tutorial/floatingpoint.html)。
