"""Reproducible offline experiments; no network or application database access."""
import argparse,collections,csv,hashlib,json,pathlib,re
import numpy as np
from sklearn.cluster import KMeans
from sklearn.dummy import DummyClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import accuracy_score,adjusted_rand_score,confusion_matrix,f1_score,recall_score,silhouette_score
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import MultiLabelBinarizer,StandardScaler,normalize
from sklearn.svm import LinearSVC

SEED=42

def text_groups(texts):
 cleaned=[re.sub(r'[^\w]','',t.lower()) for t in texts]
 grams=[{t[i:i+3] for i in range(max(1,len(t)-2))} for t in cleaned]
 parent=list(range(len(texts)))
 def root(i):
  while parent[i]!=i:parent[i]=parent[parent[i]];i=parent[i]
  return i
 for i in range(len(texts)):
  for j in range(i):
   same=cleaned[i]==cleaned[j]
   if not same and min(len(cleaned[i]),len(cleaned[j]))>=12:
    same=len(grams[i]&grams[j])/max(1,len(grams[i]|grams[j]))>=.85
   if same:parent[root(i)]=root(j)
 return [root(i) for i in range(len(texts))]

def split_indices(y,groups):
 folds=[test.tolist() for _,test in StratifiedGroupKFold(n_splits=5,shuffle=True,random_state=SEED).split(np.zeros(len(y)),y,groups)]
 return {'train':sorted(folds[2]+folds[3]+folds[4]),'validation':sorted(folds[1]),'test':sorted(folds[0])}

def metrics(y,pred):
 return {'accuracy':float(accuracy_score(y,pred)),'macroF1':float(f1_score(y,pred,average='macro',zero_division=0)),'negativeRecall':float(recall_score(y,pred,pos_label=0,zero_division=0)),'confusion':confusion_matrix(y,pred,labels=[0,1]).tolist()}

def run(args):
 repo=pathlib.Path(__file__).resolve().parents[2]
 china=pathlib.Path(args.china);us=pathlib.Path(args.us)
 rows=list(csv.DictReader(china.open(encoding='utf-8-sig')))
 texts=[r['review'] for r in rows];y=np.array([int(r['label']) for r in rows]);groups=text_groups(texts);splits=split_indices(y,groups)
 for a in splits:
  for b in splits:
   if a!=b:assert not {groups[i] for i in splits[a]} & {groups[i] for i in splits[b]}
 def subset(indices):return [texts[i] for i in indices],y[indices]
 train,yt=subset(splits['train']);valid,yv=subset(splits['validation']);test,ys=subset(splits['test'])
 vector=lambda:TfidfVectorizer(analyzer='char',ngram_range=(1,3),min_df=2,max_features=12000,sublinear_tf=True)
 models={'多数类基线':DummyClassifier(strategy='most_frequent'),'字符 TF-IDF + 朴素贝叶斯':make_pipeline(vector(),MultinomialNB(alpha=1)),'字符 TF-IDF + 线性 SVM':make_pipeline(vector(),LinearSVC(C=1,random_state=SEED)),'类别平衡线性 SVM':make_pipeline(vector(),LinearSVC(C=1,class_weight='balanced',random_state=SEED))}
 validation={}
 for name,model in models.items():model.fit(train,yt);validation[name]=metrics(yv,model.predict(valid))
 selected=max(validation,key=lambda n:validation[n]['macroF1'])
 # Model family chosen on validation only; held-out test remains untouched until here.
 results=[]
 for name,model in models.items():results.append({'name':name,'validation':validation[name],'test':metrics(ys,model.predict(test))})
 manifest=[{'text_id':rows[i]['text_id'],'group':groups[i],'split':s} for s,idx in splits.items() for i in idx]
 (repo/'experiments/mining/split-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
 providers=[json.loads(line) for line in (us/'providers.jsonl').read_text(encoding='utf-8').splitlines()]
 reviews=[json.loads(line) for line in (us/'reviews.jsonl').read_text(encoding='utf-8').splitlines()]
 ratings=collections.defaultdict(list)
 for r in reviews:ratings[r['gmap_id']].append(r['rating'])
 cats=MultiLabelBinarizer().fit_transform([r['category'] or [] for r in providers])
 numeric=np.array([[np.log1p(len(ratings[r['gmap_id']])) ,np.mean(ratings[r['gmap_id']]),np.mean(np.array(ratings[r['gmap_id']])<=2)] for r in providers])
 # Equal block weighting: standardized numeric block and normalized category block.
 x=np.hstack([normalize(cats),normalize(StandardScaler().fit_transform(numeric))])
 trials=[];fits={}
 for k in range(2,7):
  km=KMeans(n_clusters=k,n_init=20,random_state=SEED).fit(x);fits[k]=km
  stability=[adjusted_rand_score(km.labels_,KMeans(n_clusters=k,n_init=20,random_state=s).fit_predict(x)) for s in [7,21,84]]
  trials.append({'k':k,'silhouette':float(silhouette_score(x,km.labels_)),'stabilityARI':float(np.mean(stability)),'minClusterSize':int(np.bincount(km.labels_).min())})
 best=max(trials,key=lambda t:t['silhouette']);labels=fits[best['k']].labels_
 clusters=[]
 for c in range(best['k']):
  idx=np.flatnonzero(labels==c);categories=collections.Counter(cat for i in idx for cat in providers[i]['category'] or [])
  rr=[v for i in idx for v in ratings[providers[i]['gmap_id']]]
  clusters.append({'id':c+1,'size':len(idx),'reviewCount':len(rr),'meanRating':float(np.mean(rr)),'negativeShare':float(np.mean(np.array(rr)<=2)),'categories':[{'name':n,'count':v} for n,v in categories.most_common(4)]})
 report={'schemaVersion':1,'seed':SEED,'sources':[{'name':'ChineseNlpCorpus 热水器评论','url':'https://github.com/SophonPlus/ChineseNlpCorpus/tree/master/datasets/online_shopping_10_cats','scope':'中文电商评价；具体平台、地域和原始采集时间不详，并非装修订单。'},{'name':'UCSD Google Local / Vermont','url':'https://mcauleylab.ucsd.edu/public_datasets/gdrive/googlelocal/','scope':'美国 Vermont 施工维修商家，历史数据截至 2021-09。'}],'inputHashes':{str(p.name):hashlib.sha256(p.read_bytes()).hexdigest() for p in [china,us/'providers.jsonl',us/'reviews.jsonl']},'classification':{'samples':len(rows),'negative':int(sum(y==0)),'positive':int(sum(y==1)),'groups':len(set(groups)),'splits':{s:{'count':len(idx),'negative':int(sum(y[idx]==0)),'positive':int(sum(y[idx]==1))} for s,idx in splits.items()},'selected':selected,'models':results,'protocol':'按规范化文本及字符三元组 Jaccard ≥ 0.85 分组，固定五折分组分层划分为训练/验证/测试约 60/20/20。向量化仅拟合训练集；以验证集 Macro-F1 选择模型，不用测试集调参。','limitations':['标签来自公开整理语料，缺少一手标注过程。','测试集较小，单次划分不能代表稳定泛化能力。','没有商家、用户或时间字段，不能评估跨商家或未来时段泛化。','近重复检测是启发式方法，不能保证消除所有语义重复。']},'clustering':{'providers':len(providers),'reviews':len(reviews),'selectedK':best['k'],'trials':trials,'clusters':clusters,'protocol':'类别多热编码归一化 + 评价量 log(1+n)、均分、低分比例标准化并块归一化；K-means，k=2..6，n_init=20。按轮廓系数选择 k，另用三个随机种子检查 ARI 稳定性。','limitations':['170 家仅为探索性小样，类别及地域筛选存在偏差。','聚类使用全期描述统计，不用于历史预测或推荐效果证明。','群体特征是聚类输入的描述，不是独立正确性标签。','不同种子的稳定性不等于抽样稳定性或业务有效性。']}}
 (repo/'src/data/mining-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'selected':selected,'classification':results,'clustering':trials},ensure_ascii=False,indent=2))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--china',required=True);p.add_argument('--us',required=True);run(p.parse_args())
