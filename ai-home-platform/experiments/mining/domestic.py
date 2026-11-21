"""Small, rate-limited public residential case corpus. No accounts or personal contacts."""
import os
for k in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS']: os.environ[k]='4'
import urllib.request,re,json,pathlib,time,html,datetime,sys
refresh="--refresh" in sys.argv
import numpy as np
from sklearn.feature_extraction import DictVectorizer
from sklearn.preprocessing import StandardScaler,normalize
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
root=pathlib.Path(__file__).resolve().parents[2]
cache=root/'experiments/source-audit/domestic-cache';cache.mkdir(parents=True,exist_ok=True)
op=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def fetch(url):
 key=re.sub(r'[^a-zA-Z0-9]','_',url)+'.html';p=cache/key
 if p.exists() and not refresh:return p.read_text(encoding='utf-8')
 time.sleep(1)
 s=op.open(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=20).read().decode('utf-8','replace');p.write_text(s,encoding='utf-8');return s
def text(s):return re.sub(r'\s+',' ',html.unescape(re.sub('<[^>]+>',' ',re.sub(r'<(script|style)\b.*?</\1>','',s,flags=re.S))))
s=fetch('https://www.shejiben.com/works/home/')
urls=list(dict.fromkeys(re.findall(r'https://www.shejiben.com/sjs/\d+/case-\d+-1.html',s)))
rows=[];errors=[]
for url in urls:
 try:
  raw=fetch(url);t=text(raw)
  m=re.search(r'参考造价：\s*([^|]+)\|\s*风格：([^|]+)\|\s*空间：([^|]+)\|\s*面积：([\d.]+)平米',t)
  if not m:errors.append({'url':url,'reason':'missing structured fields'});continue
  title=html.unescape(re.search(r'<title>(.*?)</title>',raw,re.S)[1]);title=title.split(' - ')[1] if ' - ' in title else title
  provider_id=re.search(r'/sjs/(\d+)/',url)[1]
  # Author city is not project city; preserve both distinction and unknowns.
  author=re.search(r'([^<>]{1,100})</a>\s*(?:<[^>]*>\s*)*',raw)
  segment=t.split('相关推荐')[-1]
  citymatch=re.search(r'(北京|上海|天津|重庆|安徽|江苏|浙江|广东|湖北|四川|福建|山东|河南|湖南|陕西|河北|江西|辽宁|贵州|云南|广西)\s+([\u4e00-\u9fff]{2,8})\s+\d+\s*预约',segment)
  location=citymatch[1]+' '+citymatch[2] if citymatch else None
  namepart=segment.split(citymatch[0])[0] if citymatch else ''
  # Prefer structured profile link text where available; otherwise label by public identifier.
  links=re.findall(r'<a\b[^>]*href=[\"\'](?:https://www.shejiben.com)?/sjs/'+provider_id+r'/?[\"\'][^>]*>(.*?)</a>',raw,re.S)
  names=[text(x).strip() for x in links if text(x).strip()]
  name=next((n for n in names if len(n)<60 and '首页' not in n),'设计方 '+provider_id)
  rows.append({'id':re.search(r'case-(\d+)',url)[1],'url':url,'title':title,'providerId':provider_id,'providerName':name,'providerUrl':'https://www.shejiben.com/sjs/'+provider_id+'/','providerLocation':location,'style':m[2].strip(),'space':m[3].strip(),'area':float(m[4]),'costYuan':float(m[1].replace('万元','').strip())*10000 if '万元' in m[1] else None})
 except Exception as e:errors.append({'url':url,'reason':str(e)})
(cache.parent/'domestic-collection.json').write_text(json.dumps({'rows':rows,'errors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
assert len(rows)>=10, 'Insufficient verified samples'
cat=normalize(DictVectorizer(sparse=False).fit_transform([{'style':r['style'],'space':r['space']} for r in rows]))
median_cost=float(np.median([r['costYuan']/r['area'] for r in rows if r['costYuan'] is not None]))
num=StandardScaler().fit_transform([[np.log1p(r['area']),np.log1p(r['costYuan']/r['area'] if r['costYuan'] is not None else median_cost),float(r['costYuan'] is None)] for r in rows])
trials=[]
for weight in [.5,.8,1.]:
 x=np.hstack([np.sqrt(weight)*cat,np.sqrt(1-weight)*normalize(num)])
 for k in range(2,min(7,len(rows))):
  labels=KMeans(n_clusters=k,n_init=20,random_state=42).fit_predict(x)
  trials.append({'weight':weight,'k':k,'silhouette':float(silhouette_score(x,labels))})
best=max([t for t in trials if t['weight']==.8],key=lambda t:t['silhouette'])
x=np.hstack([np.sqrt(.8)*cat,np.sqrt(.2)*normalize(num)])
labels=KMeans(n_clusters=best['k'],n_init=20,random_state=42).fit_predict(x)
for r,l in zip(rows,labels):r['cluster']=int(l)+1
out={'source':'设计本公开住宅案例','sourceUrl':'https://www.shejiben.com/works/home/','collectedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'cases':rows,'styles':sorted({r['style'] for r in rows}),'clustering':{'selected':best,'trials':trials},'limitations':['首页近期案例便利样本，不能代表整个市场。','参考造价是案例历史造价，不是报价承诺；机构城市不是案例地址或服务范围。','没有用户偏好或成交标签，不报告推荐准确率。','多视图加权K-means是组合设计，不声称原创算法。']}
target=root/('experiments/source-audit/domestic-live.json' if refresh else 'src/contracts/domestic-recommendation.json')
temp=target.with_suffix('.tmp');temp.write_text(json.dumps(out,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8');temp.replace(target)
print(json.dumps({'discovered':len(urls),'collected':len(rows),'providers':len({r['providerId'] for r in rows}),'locations':sum(r['providerLocation'] is not None for r in rows),'errors':errors,'clustering':best},ensure_ascii=False))
