const fs = require('fs/promises');
const path = require('path');
const readline = require('readline');
const puppeteer = require('puppeteer');
const chalk = require('chalk');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

class CustomPage {
	static async build(url) {
		const browser = await puppeteer.launch({
			headless: false,
			args: ['--no-sandbox'],
		});

		const page = await browser.newPage();
		await (await browser.pages())[0].close();
		const customPage = new CustomPage(page, browser, url, ['1080', 'HD']);

		return new Proxy(customPage, {
			get(target, property) {
				return customPage[property] || browser[property] || page[property];
			},
		});
	}

	constructor(
		page,
		browser,
		url,
		downloadQualities = ['1080', '720', '480', '360', 'HD', 'SD'],
		maxConsecutiveTabs = 5
	) {
		this.page = page;
		this.browser = browser;
		this.url = url;
		this.maxConsecutiveTabs = maxConsecutiveTabs;
		this.downloadQualities = downloadQualities.map(c => (c == 'HD' ? 2 : c == 'SD' ? 1 : c));
	}

	async getEpDownloadPage(epLink) {
		const tempPage = await this.browser.newPage();

		await tempPage.goto(epLink, {
			waitUntil: 'networkidle0',
		});

		let downloadPage = await tempPage.evaluate(() => {
			return VidStreaming?.replace('load.php', 'download');
		});

		await tempPage.close();

		return downloadPage;
	}

	async getEpDownloadPages(failedEps) {
		let downloadPages = [];

		const epCount =
			failedEps?.length || (await this.page.evaluate(() => document.querySelectorAll('.infoepboxmain a').length));

		const tabs = this.maxConsecutiveTabs;
		const turns = Math.ceil(epCount / tabs);
		const batches = [];

		batches.length = turns;
		batches.fill(tabs);
		batches[turns - 1] = epCount % tabs || tabs;

		console.log(chalk.hex('#80D8FF')(`Total download pages: ${epCount}`));
		console.log();
		console.log(chalk.hex('#80D8FF')('Fetching download pages...'));

		for (let j = 0; j < turns; j++) {
			let _downloadPages = [];

			for (let i = 1; i <= batches[j]; i++) _downloadPages.push(i + tabs * j);

			_downloadPages = failedEps?.length ? _downloadPages.map((c, i) => failedEps[i * j].ep) : _downloadPages;

			_downloadPages = await Promise.all(
				_downloadPages.map(ep => this.getEpDownloadPage(`${this.url}-episode-${ep}`))
			);

			downloadPages.push(..._downloadPages);

			console.log(chalk.hex('#B9F6CA')(downloadPages.length + '...'));
		}

		return downloadPages;
	}

	async getDownloadLinkData(downloadPage, ep) {
		const downloadLinkData = { ep };
		const tempPage = await this.browser.newPage();

		await tempPage.setRequestInterception(true);
		tempPage.on('request', request => {
			if (request.url().includes('.anicdn.stream/')) return request.abort();
			if (request.url().includes('storage.googleapis.com/')) {
				downloadLinkData.url = request.url();
				downloadLinkData.referrer = downloadPage;
				return request.abort();
			}
			request.continue();
		});

		tempPage.on('response', response => {
			if (response.headers().location?.includes('.anicdn.stream/')) {
				downloadLinkData.referrer = response.url();
				downloadLinkData.url = response.headers().location;
			}
		});

		await tempPage.goto(downloadPage, {
			waitUntil: 'networkidle0',
			timeout: 200000,
		});

		let downloadQualities = await tempPage.evaluate(() => {
			return Array.from(document.querySelector('.mirror_link').querySelectorAll('a'))
				.map(c => ({
					q: c.innerText
						.match(/\d+(?=P)|HD|SD/)[0]
						?.replace('HD', 2)
						.replace('SD', 1),
					url: c.href,
				}))
				.sort((a, b) => +b.q - +a.q);
		});

		await this.later(2000);

		for (const qualityObj of downloadQualities.filter(c => this.downloadQualities.includes(c.q))) {
			await tempPage.evaluate(quality => {
				Array.from(document.querySelector('.mirror_link').querySelectorAll('a'))
					.filter(c => c.innerText.includes(quality == 1 ? 'SD' : quality == 2 ? 'HD' : quality))[0]
					.click();
			}, qualityObj.q);

			await this.later(1000);

			if (downloadLinkData.referrer && downloadLinkData.url) {
				downloadLinkData.quality = qualityObj.q == 1 ? 'SD' : qualityObj.q == 2 ? 'HD' : qualityObj.q;
				break;
			}

			await tempPage.goto(downloadPage, {
				waitUntil: 'networkidle0',
				timeout: 200000,
			});

			await this.later(1000);
		}

		downloadLinkData.qualities = downloadQualities.map(c => (c.q == 1 ? 'SD' : c.q == 2 ? 'HD' : c.q));

		await tempPage.close();

		return downloadLinkData;
	}

	async getDownloadLinksData(failedEps) {
		const downloadPages = await this.getEpDownloadPages(failedEps);

		console.log(chalk.hex('#69F0AE')('Successfully fetched all download pages!'));
		console.log();
		console.log(chalk.hex('#80D8FF')('Getting download links...'));

		const downloadLinksData = [];
		const tabs = this.maxConsecutiveTabs;
		const turns = Math.ceil(downloadPages.length / tabs);

		for (let j = 0; j < turns; j++) {
			const _downloadLinksData = await Promise.all(
				downloadPages.slice(tabs * j, tabs * (j + 1)).map(async (downloadPage, ep) => {
					let downloadLinkData;
					for (let k = 0; k < 2; k++) {
						downloadLinkData = await this.getDownloadLinkData(downloadPage, ep + 1 + j * tabs);
						if (downloadLinkData.url && downloadLinkData.referrer) break;
					}
					return downloadLinkData;
				})
			);
			downloadLinksData.push(..._downloadLinksData);

			console.log(chalk.hex('#B9F6CA')(downloadLinksData.length + '...'));
		}

		console.log(chalk.hex('#69F0AE')('Successfully got all download links!'));
		console.log();

		return { links: downloadLinksData };
	}

	async getAnimeName() {
		await this.page.goto(this.url, {
			waitUntil: 'networkidle0',
		});

		let animeName = await this.page.evaluate(() => document.querySelector('h1.infodes').innerText);

		return animeName.replace(/:/g, ' - ');
	}

	later(delay) {
		return new Promise(function (resolve) {
			setTimeout(resolve, delay);
		});
	}
}

const main = async url => {
	console.log(chalk.hex('#FF8A65')('Starting...'));
	console.log();

	const Page = await CustomPage.build(url);
	try {
		const animeName = await Page.getAnimeName();

		const linksPath = path.join(__dirname, `./anime/${animeName}.json`);

		let storedDownloadLinksData;

		try {
			storedDownloadLinksData = JSON.parse(await fs.readFile(linksPath, { encoding: 'utf-8' }));
		} catch (e) {}

		const storedFailedEps = storedDownloadLinksData?.failedEps;

		const downloadLinksData = await Page.getDownloadLinksData(storedFailedEps);

		const failedEps = downloadLinksData.links.filter(c => !c.referrer || !c.url);

		downloadLinksData = { name: animeName, failedEps, ...downloadLinksData };

		if (storedFailedEps?.length) {
			downloadLinksData.links.push(
				...storedDownloadLinksData.links.filter(c => !storedFailedEps.find(cur => cur.ep == c.ep))
			);

			downloadLinksData.links.sort((a, b) => a.ep - b.ep);
		}

		console.log(chalk.hex('#80D8FF')(`Writing links to ${linksPath}...`));

		try {
			await fs.mkdir(path.join(__dirname, './anime'));
		} catch (e) {}

		await fs.writeFile(linksPath, JSON.stringify(downloadLinksData));

		console.log(chalk.hex('#69F0AE')(`Successfully wrote links to ${linksPath}`));
		console.log();
		console.log(chalk.hex('#80D8FF')('Closing puppeteer...'));

		let pages = await Page.browser.pages();

		await Promise.all(pages.map(page => page.close()));
		await Page.browser.close();

		console.log(chalk.hex('#69F0AE')('Successfully closed puppeteer!'));
		console.log();

		console.log(
			chalk.hex('#80D8FF')('Got all links:'),
			chalk.hex(failedEps.length ? '#DD2C00' : '#00C853')(!failedEps.length)
		);
		if (failedEps.length)
			console.log(
				chalk.hex('#DD2C00')(
					`Failed to fetch download links for these episodes: ${failedEps.reduce(
						(a, c) => `${a} ${c.ep}`,
						''
					)}`
				)
			);
		console.log();
		if (!failedEps.length) {
			try {
				await fs.mkdir(path.join(__dirname, './cache'));
			} catch (e) {}

			const cache = path.join(__dirname, './cache/cache.json');

			let exists = true;
			try {
				await fs.access(cache);
			} catch (e) {
				exists = false;
			}

			let data = exists ? JSON.parse(await fs.readFile(cache, { encoding: 'utf-8' })) : [];
			data = data.filter(c => c.name !== downloadLinksData.name);

			await fs.writeFile(
				cache,
				JSON.stringify([
					...data,
					{
						name: downloadLinksData.name,
						downloaded: false,
						timestamp: new Date().getTime(),
					},
				])
			);

			await exec('python animekisa.py');
			console.log(chalk.hex('#00E676')('Started Downloads in IDM!'));
			console.log();
		}
	} catch (e) {
		let pages = await Page.browser.pages();
		await Promise.all(pages.map(page => page.close()));
		await Page.browser.close();

		console.error(e);
		process.exit();
	}
};
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

rl.question(chalk.bold.hex('#F8EFBA')('Input exact anime url from animekisa.tv: '), url => {
	if (!url || !url.startsWith('https://animekisa.tv/')) {
		console.log(chalk.hex('#DD2C00')('Invalid URL!'));
		return rl.close();
	}

	console.log();
	console.log(chalk.hex('#80D8FF')(url));
	console.log();

	main(url).catch(e => {
		console.log(e);
		console.log(chalk.hex('#DD2C00')('An error occurred'));
	});
	rl.close();
});
