import requests,json,os,re,concurrent.futures
from urllib.parse import quote
from PIL import Image
D=os.path.dirname(__file__)
headers={'User-Agent':'TravelVisualResearch/1.0 (site prototype asset preparation)'}
places={'ES':'Park Güell','FR':'Champ de Mars','DE':'Brandenburg Gate','IT':'Colosseum','PL':'Wawel Castle','CZ':'Charles Bridge','HU':'Hungarian Parliament Building','GR':'Acropolis of Athens'}
s=requests.Session();s.headers.update(headers)
q=s.get('https://en.wikipedia.org/w/api.php',params={'action':'query','format':'json','titles':'|'.join(places.values()),'prop':'pageimages','piprop':'thumbnail|name','pithumbsize':800},timeout=25).json()['query']['pages']
pages={p['title']:p for p in q.values()}
files='|'.join('File:'+p['pageimage'] for p in pages.values())
r=s.get('https://commons.wikimedia.org/w/api.php',params={'action':'query','format':'json','titles':files,'prop':'imageinfo','iiprop':'extmetadata|url'},timeout=25).json()['query']['pages']
meta={p['title'][5:]:p.get('imageinfo',[{}])[0] for p in r.values()}
def clean(v):return re.sub('<[^>]+>','',v or '')
def download(item):
    code,title=item;p=pages[title];url=p['thumbnail']['source'];m=meta.get(p['pageimage'],{});e=m.get('extmetadata',{})
    r=requests.get(url,headers=headers,timeout=25);r.raise_for_status()
    path=os.path.join(D,code.lower()+'.jpg');open(path,'wb').write(r.content)
    im=Image.open(path).convert('RGB');im.thumbnail((960,960));im.save(path,quality=83,optimize=True)
    result={'country':code,'subject':title,'file':code.lower()+'.jpg','source_page':'https://commons.wikimedia.org/wiki/File:'+quote(p['pageimage']),'source_image':url,'author':clean(e.get('Artist',{}).get('value','')),'license':e.get('LicenseShortName',{}).get('value',''),'license_url':e.get('LicenseUrl',{}).get('value',''),'attribution':clean(e.get('Attribution',{}).get('value','')),'changes':'Resized and JPEG compressed for web display; display may crop.'}
    print(code,im.size,os.path.getsize(path),result['license'],flush=True);return result
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
  results=list(ex.map(download,places.items()))
json.dump(results,open(os.path.join(D,'sources.json'),'w'),ensure_ascii=False,indent=2)
