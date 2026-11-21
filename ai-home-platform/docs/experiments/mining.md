# 数据挖掘实验复现与验收

## 本次交付

首页“数据挖掘实验室”进入 /mining；原需求匹配页 `/owner/matches/[id]` 现在在原服务方匹配结果下展示国内住宅案例推荐。案例推荐使用设计本公开住宅案例，依据当前需求的面积、预算、改造描述与案例风格排序，并支持按案例画像群体筛选。原有施工服务方匹配、报价和履约入口保持不变。

## 数据

中文输入：C:/Users/PC/Documents/ChatGPT/黑课松/data-china/processed/water_heater_clean.csv，574 条（正向 474、负向 100）。源数据是 ChineseNlpCorpus 整理的电商评价，具体平台、地域和采集时间不详。不能声称全部属于中国装修服务。

美国输入：C:/Users/PC/Documents/ChatGPT/黑课松/data-pilot/processed，170 家施工维修商家、2,981 条评价。UCSD Google Local，Vermont，截至 2021-09。来源与清洗脚本在对应数据目录。原始数据不纳入 Git。聚合结果中没有原始评论、用户 ID 或商家名称。

## 复现

在仓库根目录创建独立 Python 3.12 环境（已有环境不覆盖），按 experiments/mining/requirements.txt 安装锁定版本。

```powershell
uv venv --python 3.12 .venv-mining
uv pip install --python .venv-mining/Scripts/python.exe -r experiments/mining/requirements.txt
.\.venv-mining\Scripts\python.exe -m unittest discover -s experiments/mining -p test_pipeline.py
.\.venv-mining\Scripts\python.exe experiments/mining/pipeline.py --china C:/Users/PC/Documents/ChatGPT/黑课松/data-china/processed/water_heater_clean.csv --us C:/Users/PC/Documents/ChatGPT/黑课松/data-pilot/processed
npm.cmd run check
npm.cmd run build
npm.cmd run start -- --port 3100
```

输入路径可以替换。固定种子 42，输出 src/data/mining-results.json 及 experiments/mining/split-manifest.json。数据哈希记录在结果里。换数据重跑后不得继续引用旧实验数字。

## 方法与结果

分类：清洗文本后，规范化相同文本或三元组 Jaccard >=0.85 的长文本合并为组，使用五折 StratifiedGroupKFold 分成约 60/20/20；字符 TF-IDF 仅拟合训练集。模型选择只看验证集 Macro-F1；测试集用于最终并列报告，不重新调参。固定选定普通线性 SVM；测试 Macro-F1 0.7929、准确率 0.8957、负向召回率 0.55。多数类基线 Macro-F1 0.4524。平衡权重 SVM 的测试 F1 虽略高，但验证集略低，因此没有事后改选它。测试只有 20 条负向样本，不能夸大稳定性。

聚类：类别多热向量归一化，评价量 log(1+n)、均分、低分比例先标准化再块归一化，与类别块等权拼接。比较 k=2..6，K-means n_init=20；轮廓系数选择 k=3，得分约 0.2626，三个额外种子的平均 ARI 约 0.9861。分离程度有限，稳定不代表业务真值。全期评价仅用于描述分析，不用于时序预测。没有算法首创或已验证创新的声明。

## 限制

中文评论只有一个产品类别，训练数据来源和标签质量有限；近重复识别是启发式，缺少用户、商家和日期。聚类样本地域单一且可能混有商业施工。两个任务使用独立数据，不能解读为同一批订单的完整智能闭环。属于可运行的课程基线和实验看板。

## 本次实际验收（2026-11-18）

- Python 数据划分测试 2/2 通过；实验脚本成功运行。
- npm run check：1,025/1,025 测试通过，lint/typecheck/boundaries 通过。首次受限环境本地服务测试超时；正常权限重跑通过。新 clone 无数据库配置时四个原有接口测试返回 503，设置独立 DATABASE_URL=file:./mining-validation.db 并同步 schema 后完整通过。
- npm run build 通过，/mining 静态生成成功。受限环境创建 .next 子目录出现 EPERM，正常权限构建通过。
- npm run scope -- --role D --base origin/main 通过。
- 本机生产预览 http://127.0.0.1:3100/mining 返回 200，验证首页 /mining 链接和 79.3% 指标已渲染。没有进行浏览器视觉验收。
- 预览进程 PID 50972，仅绑定 127.0.0.1:3100。停止方式：Stop-Process -Id 50972（先确认仍是本次 node 进程）。新页面无需数据库；预览未配置整个平台业务运行库。
- 修改保存在 feature/D-data-mining-lab 分支工作区，未提交、未推送。依赖安装报告原有 Node 锁定依赖存在安全告警，未做与本次无关的依赖升级；本次仅本地预览。
