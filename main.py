import json
from idm import IDMan

downloader = IDMan()

cachePath = './cache/cache.json'

cache = open(cachePath, 'r')

cacheData = json.load(cache)

for c in cacheData:
    if c['downloaded']:
        continue

    links = open('./anime/' + c['name'] + '.json')
    linksData = json.load(links)

    for link in linksData['links']:
        url = link['url']
        referrer = link['referrer']
        name = linksData['name'] + ' -- ep ' + str(link['ep']) + '.mp4'

        downloader.download(url, 'E:\\Anime\\' +
                            linksData['name'], output=name, referrer=referrer, confirm=False)
    c['downloaded'] = True

cache = open(cachePath, 'w')

cache.write(json.dumps(cacheData))
