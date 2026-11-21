# 基于服务方画像与聚类的家装服务推荐系统

## 在线入口

启动生产预览后访问 `http://127.0.0.1:3100/recommend`。首页也提供“服务方推荐”入口。

推荐页支持在线选择服务任务、评价质量/样本充分偏好、聚类群体、最少评价数、纬度/经度和服务半径，并实时请求 `GET /api/recommendation`。结果会展示排序分、评价证据、聚类解释、距离和最多三家对比。地图是画像特征的 PCA 投影，不是地理地图。

公开数据中的商家是美国 Vermont 历史样本，不属于平台的可接单服务方目录；推荐页明确显示研究数据来源和不可预约边界。原有业主需求、匹配、报价、施工和管理功能保持不变。

## 算法

服务方画像由四类信息组成：公开类别多热向量、评价数量、贝叶斯收缩评分和低分比例。评分使用全体评价均值作为先验，避免少量满分样本被直接当成可靠高质量。类别列使用 IDF 权重，类别视图与数值视图分别归一化后合并。

聚类主方法是多视图加权 K-means：类别视图权重 0.8，评价数值视图权重 0.2，`k=6` 由主特征空间轮廓系数选择；随机种子 7、21、84 用 ARI 检查稳定性。等权 0.5 和去除数值视图 1.0 是消融对照。权重改变了距离空间，因此不同权重的轮廓系数只作结构参考，不能直接说某个权重在业务上更好。

在线推荐先按任务类别筛选，再结合贝叶斯收缩评分、样本证据、可选群体任务覆盖率和可选地理距离排序。默认任务画像推荐与“画像 + 聚类”可以切换，排序理由逐条展示。

## 真实评估

公开数据有 2981 条评价、170 家商家和 2869 个用户，其中 96 位用户评价过多家商家。按评价时间前 80% 训练、后 20% 测试，训练统计和聚类不读取测试评价；只评估有历史正向评价且测试阶段评价了新商家的用户，共 17 人。结果为：

| 方法 | Recall@10 | NDCG@10 |
|---|---:|---:|
| 收缩评分基线 | 0.1765 | 0.0562 |
| 历史类别画像 | 0 | 0 |
| 历史画像 + 聚类 | 0 | 0 |

这说明当前样本下聚类推荐没有超过基线，系统没有把聚类强行设为默认最优。原因包括重复用户很少、商家类别是静态快照、未观察商家不等于用户不喜欢，以及公开评价数据没有装修需求字段。在线页面推荐是任务适配演示，不能把上述小样本结果解释成真实家装转化率提升。

## 复现

数据不进入 Git。准备 Python 3.12 环境并执行：

```powershell
uv venv --python 3.12 .venv-mining
uv pip install --python .venv-mining/Scripts/python.exe -r experiments/mining/requirements.txt
$env:OMP_NUM_THREADS="4"
$env:OPENBLAS_NUM_THREADS="4"
$env:MKL_NUM_THREADS="4"
.\.venv-mining\Scripts\python.exe experiments/mining/recommendation.py --source C:/Users/PC/Documents/ChatGPT/黑课松/data-pilot/processed
.\.venv-mining\Scripts\python.exe experiments/mining/pipeline.py --china C:/Users/PC/Documents/ChatGPT/黑课松/data-china/processed/water_heater_clean.csv --us C:/Users/PC/Documents/ChatGPT/黑课松/data-pilot/processed
npm.cmd run check
npm.cmd run build
npm.cmd run start -- --hostname 127.0.0.1 --port 3100
```

生成的 `src/data/recommendation.json` 只含聚合画像、任务标签、簇编号和二维投影，不含评价正文或用户标识。若换数据，必须重新运行脚本并重新核对页面数字。
