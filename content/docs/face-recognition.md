---
title: 简单的人脸识别
slug: face-recognition
collection: vision
order: 4
tags: [OpenCV, 图像处理, 人脸识别, 视觉组教程]
summary: 正确区分图像处理、检测与身份比对，完成一个可运行的人脸检测示例，并理解模型与阈值验证。
---

# 简单的人脸识别


--

目标：理解图像数组，运行人脸检测，并解释识别链路中的模型、对齐和阈值。


--

本课检测实验使用 OpenCV 4.x Python 绑定；检测框不等于识别出了某个人。

----
## 图像的形状与类型


--

<!--fig:image-pixels-->


--

常见 8 位彩色图像是 `(高, 宽, 3)` 的 uint8 数组，像素分量取值 0–255；灰度图通常是 `(高, 宽)` 二维数组。
图像也可以是浮点、16 位、带 alpha 或其他格式，不能把所有图像都限定为 0–255。


--

OpenCV 默认彩色 `imread` 得到 BGR；索引是 `img[y, x]`，`resize` 的尺寸参数是 `(宽, 高)`。

----
## 安装一个 OpenCV 包


--

在已激活的虚拟环境中：


--

```bash
python -m pip install opencv-python
python -c "import cv2; print(cv2.__version__)"
```


--

`opencv-python`、`opencv-contrib-python` 及其 headless 变体共享 `cv2` 命名空间，同一个环境选择一个，不要同时安装。
只有需要额外 contrib 模块时才换相应包；SIFT 已在现代 OpenCV 主模块中。

----
## 读入与处理时检查失败


--

```python
import cv2
image = cv2.imread('input.jpg')
if image is None:
    raise FileNotFoundError('Cannot read input.jpg')
gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
blurred = cv2.GaussianBlur(gray, (5, 5), 0)
edges = cv2.Canny(blurred, 80, 160)
if not cv2.imwrite('edges.png', edges):
    raise OSError('Cannot write edges.png')
```


--

阈值仅为教学起点，需根据输入检查结果；错误路径应保留具体文件名。

----
## 灰度化并非所有模型的第一步


--

常见转换使用近似权重 `Y = 0.299R + 0.587G + 0.114B`。
灰度化丢弃色彩信息，适合部分传统算法；深度模型应遵循训练时的通道顺序、归一化和尺寸要求。


--

不能为了“更快”把需要 RGB 输入的模型随意改成灰度输入。

----
## 图像处理不只有卷积


--

<!--fig:conv-kernel-->


--

线性滤波可以通过核与局部像素的加权和描述；OpenCV `filter2D` 实际计算相关运算，不自动翻转核。
中值滤波、形态学、几何变换和直方图方法不是简单的“换一个卷积核”。


--

计算可能出现负值的响应时，用浮点输出避免 uint8 截断：


--

```python
import numpy as np
kernel = np.array([[0, -1, 0], [-1, 4, -1], [0, -1, 0]], dtype=np.float32)
response = cv2.filter2D(gray, cv2.CV_32F, kernel)
```


--

这里 `gray` 来自前面的读图示例。

----
## 完整的人脸检测实验


--

保存为 `detect_faces.py`，准备一张 `input.jpg`：


--

```python
import cv2
image = cv2.imread('input.jpg')
if image is None:
    raise FileNotFoundError('Cannot read input.jpg')
cascade = cv2.CascadeClassifier(
    cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
if cascade.empty():
    raise RuntimeError('Cannot load cascade')
gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
faces = cascade.detectMultiScale(gray, 1.1, 5, minSize=(48, 48))
for x, y, width, height in faces:
    cv2.rectangle(image, (x, y), (x + width, y + height), (0, 255, 0), 2)
if not cv2.imwrite('faces.png', image):
    raise OSError('Cannot write faces.png')
print(f'detected: {len(faces)}')
```


--

运行 `python detect_faces.py`。无检测结果也可能是算法限制，不能保证任意图片都检出。

----
## 从检测走到识别


--

<!--fig:face-pipeline-->


--

| 阶段 | 输入与输出 |
|---|---|
| 检测 | 图像 → 人脸框及可选关键点 |
| 对齐 | 关键点 → 模型要求的脸部裁剪 |
| 特征 | 裁剪 → embedding |
| 比对 | 特征与参考样本 → 分数与决策 |


--

具体流程由模型约定决定。Haar 检测器不直接提供身份特征或五点关键点。

----
## 使用模型时保持预处理一致


--

OpenCV 官方 DNN 教程给出 YuNet 检测与 SFace 特征提取流程，配套模型需单独获取。


--

核心 API 顺序：`FaceDetectorYN.detect` → `FaceRecognizerSF.alignCrop` → `feature` → `match`。
阅读配套样例确认输入尺寸、输出关键点、模型文件与后端支持。


--

不要把其他模型的 112×112 尺寸或阈值直接搬过来；模型参数和预处理一起构成接口。

----
## 分数不等于概率


--

两个非零向量归一化后，点积才是余弦相似度。


--

```js run
function cosine(a, b) {
  if (a.length !== b.length || !a.length) throw new Error('维度不匹配');
  const norm = v => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  const denominator = norm(a) * norm(b);
  if (!denominator) throw new Error('零向量');
  return a.reduce((s, x, i) => s + x * b[i], 0) / denominator;
}
demo.log('相同方向:', cosine([1, 2], [2, 4]));
demo.log('正交方向:', cosine([1, 0], [0, 1]));
```


--

预期约为 1 与 0；这只演示向量几何，不是人脸特征模型。

----
## 阈值需要独立验证


--

用与实际光照、姿态、设备相符的数据，分别统计同人对与异人对分数。
选择阈值使用验证集，最终报告使用独立测试集，避免数据泄漏。


--

- FAR：异人对被接受的比例。

--

- FRR：同人对被拒绝的比例。

--

- 同时记录样本量、延迟与失败条件。


--

识别可以判断“不确定并重试”。检测、身份比对和防照片攻击是不同问题，简单眨眼检测不保证防伪能力。

----
## 练习与参考


--

1000 个异人测试对中 3 个被接受，200 个同人对中 8 个被拒绝。


--

**答案**：FAR 为 0.3%，FRR 为 4%；这只是该测试集的点估计，还要交代样本来源与不确定性。


--

改变检测器参数，记录漏检与误检案例；不要仅挑成功图片展示。


--

参考：[OpenCV 图像处理](https://docs.opencv.org/4.x/d2/d96/tutorial_py_table_of_contents_imgproc.html)、[DNN 人脸检测与识别](https://docs.opencv.org/4.x/d0/dd4/tutorial_dnn_face.html)、[OpenCV Python 包说明](https://pypi.org/project/opencv-python/)。
