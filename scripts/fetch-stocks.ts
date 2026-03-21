import { exec } from 'child_process'
import fs from 'fs/promises'
import path from 'path'

const OUTPUT_FILE = path.join(process.cwd(), 'data', 'stocks-database.json')

interface StockInfo {
  code: string
  name: string
  market: 'SH' | 'SZ' | 'BJ'
  industry: string
  sector: string
  fullName: string
  description?: string
}

async function fetchStockData(): Promise<void> {
  console.log('开始获取 A 股股票数据...')

  const script = `
const akshare = require('akshare');

async function main() {
  try {
    const stockInfo = await akshare.stock_info_a_code_name();
    const stocks = stockInfo.map(item => {
      const code = item['code'] || item['证券代码'];
      let market = 'SH';
      if (code.startsWith('0') || code.startsWith('3')) market = 'SZ';
      else if (code.startsWith('4') || code.startsWith('8')) market = 'BJ';

      return {
        code,
        name: item['name'] || item['证券名称'],
        market,
        industry: '未知',
        sector: '未知',
        fullName: item['name'] || item['证券名称']
      };
    });
    console.log(JSON.stringify(stocks));
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
`

  return new Promise((resolve) => {
    exec(`node -e "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
      timeout: 60000
    }, async (error, stdout, _stderr) => {
      if (error) {
        console.error('执行失败:', error)
        console.log('使用备用方案：生成示例数据...')
        await generateFallbackData()
        resolve()
        return
      }

      try {
        const stocks = JSON.parse(stdout)
        await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true })
        await fs.writeFile(OUTPUT_FILE, JSON.stringify(stocks, null, 2), 'utf-8')
        console.log(`数据已保存到: ${OUTPUT_FILE}`)
        console.log(`共 ${stocks.length} 只股票`)
      } catch (parseError) {
        console.error('解析失败:', parseError)
        await generateFallbackData()
      }
      resolve()
    })
  })
}

async function generateFallbackData(): Promise<void> {
  const fallbackStocks: StockInfo[] = [
    { code: '600519', name: '贵州茅台', market: 'SH', industry: '白酒', sector: '食品饮料', fullName: '贵州茅台酒股份有限公司' },
    { code: '000858', name: '五粮液', market: 'SZ', industry: '白酒', sector: '食品饮料', fullName: '宜宾五粮液股份有限公司' },
    { code: '600036', name: '招商银行', market: 'SH', industry: '银行', sector: '金融服务', fullName: '招商银行股份有限公司' },
    { code: '601318', name: '中国平安', market: 'SH', industry: '保险', sector: '金融服务', fullName: '中国平安保险股份有限公司' },
    { code: '000001', name: '平安银行', market: 'SZ', industry: '银行', sector: '金融服务', fullName: '平安银行股份有限公司' },
    { code: '600016', name: '民生银行', market: 'SH', industry: '银行', sector: '金融服务', fullName: '中国民生银行股份有限公司' },
    { code: '601166', name: '兴业银行', market: 'SH', industry: '银行', sector: '金融服务', fullName: '兴业银行股份有限公司' },
    { code: '600000', name: '浦发银行', market: 'SH', industry: '银行', sector: '金融服务', fullName: '上海浦东发展银行股份有限公司' },
    { code: '601398', name: '工商银行', market: 'SH', industry: '银行', sector: '金融服务', fullName: '中国工商银行股份有限公司' },
    { code: '601288', name: '农业银行', market: 'SH', industry: '银行', sector: '金融服务', fullName: '中国农业银行股份有限公司' },
    { code: '601939', name: '建设银行', market: 'SH', industry: '银行', sector: '金融服务', fullName: '中国建设银行股份有限公司' },
    { code: '601988', name: '中国银行', market: 'SH', industry: '银行', sector: '金融服务', fullName: '中国银行股份有限公司' },
    { code: '601328', name: '交通银行', market: 'SH', industry: '银行', sector: '金融服务', fullName: '交通银行股份有限公司' },
    { code: '600028', name: '中国石化', market: 'SH', industry: '石油化工', sector: '能源', fullName: '中国石油化工股份有限公司' },
    { code: '601857', name: '中国石油', market: 'SH', industry: '石油化工', sector: '能源', fullName: '中国石油天然气股份有限公司' },
    { code: '600050', name: '中国联通', market: 'SH', industry: '通信', sector: '科技', fullName: '中国联合网络通信股份有限公司' },
    { code: '600030', name: '中信证券', market: 'SH', industry: '证券', sector: '金融服务', fullName: '中信证券股份有限公司' },
    { code: '601012', name: '隆基绿能', market: 'SH', industry: '光伏', sector: '新能源', fullName: '隆基绿能科技股份有限公司' },
    { code: '600900', name: '长江电力', market: 'SH', industry: '电力', sector: '公用事业', fullName: '中国长江电力股份有限公司' },
    { code: '601888', name: '中国中免', market: 'SH', industry: '旅游零售', sector: '消费', fullName: '中国旅游集团中免股份有限公司' },
    { code: '600276', name: '恒瑞医药', market: 'SH', industry: '医药生物', sector: '医疗', fullName: '江苏恒瑞医药股份有限公司' },
    { code: '000333', name: '美的集团', market: 'SZ', industry: '家电', sector: '消费', fullName: '美的集团股份有限公司' },
    { code: '600887', name: '伊利股份', market: 'SH', industry: '乳制品', sector: '消费', fullName: '内蒙古伊利实业集团股份有限公司' },
    { code: '600309', name: '万华化学', market: 'SH', industry: '化工', sector: '原材料', fullName: '万华化学集团股份有限公司' },
    { code: '601899', name: '紫金矿业', market: 'SH', industry: '有色金属', sector: '原材料', fullName: '紫金矿业集团股份有限公司' },
    { code: '600585', name: '海螺水泥', market: 'SH', industry: '建材', sector: '原材料', fullName: '安徽海螺水泥股份有限公司' },
    { code: '002475', name: '立讯精密', market: 'SZ', industry: '消费电子', sector: '科技', fullName: '立讯精密工业股份有限公司' },
    { code: '300750', name: '宁德时代', market: 'SZ', industry: '锂电池', sector: '新能源', fullName: '宁德时代新能源科技股份有限公司' },
    { code: '688981', name: '中芯国际', market: 'SH', industry: '半导体', sector: '科技', fullName: '中芯国际集成电路制造有限公司' },
    { code: '002594', name: '比亚迪', market: 'SZ', industry: '新能源汽车', sector: '新能源', fullName: '比亚迪股份有限公司' },
    { code: '600104', name: '上汽集团', market: 'SH', industry: '汽车', sector: '汽车', fullName: '上海汽车集团股份有限公司' },
    { code: '600837', name: '海通证券', market: 'SH', industry: '证券', sector: '金融服务', fullName: '海通证券股份有限公司' },
    { code: '000725', name: '京东方A', market: 'SZ', industry: '显示面板', sector: '科技', fullName: '京东方科技集团股份有限公司' },
    { code: '601138', name: '工业富联', market: 'SH', industry: '电子制造', sector: '科技', fullName: '富士康工业互联网股份有限公司' },
    { code: '002415', name: '海康威视', market: 'SZ', industry: '安防', sector: '科技', fullName: '杭州海康威视数字技术股份有限公司' },
    { code: '601668', name: '中国建筑', market: 'SH', industry: '建筑', sector: '建筑', fullName: '中国建筑股份有限公司' },
    { code: '600048', name: '保利发展', market: 'SH', industry: '房地产', sector: '房地产', fullName: '保利发展控股集团股份有限公司' },
    { code: '000002', name: '万科A', market: 'SZ', industry: '房地产', sector: '房地产', fullName: '万科企业股份有限公司' },
  ]

  await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true })
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(fallbackStocks, null, 2), 'utf-8')
  console.log(`示例数据已保存到: ${OUTPUT_FILE}`)
  console.log(`共 ${fallbackStocks.length} 只股票（示例数据）`)
  console.log('如需完整数据，请先安装 akshare: pip3 install akshare')
}

fetchStockData()
  .then(() => {
    console.log('完成')
    process.exit(0)
  })
  .catch((err) => {
    console.error('失败:', err)
    process.exit(1)
  })
