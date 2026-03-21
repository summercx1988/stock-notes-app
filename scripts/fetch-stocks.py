#!/usr/bin/env python3
import json
import os
import sys

def fetch_stock_data():
    try:
        import akshare as ak
        
        print('正在获取 A 股股票数据...')
        stock_info = ak.stock_info_a_code_name()
        
        stocks = []
        for _, item in stock_info.iterrows():
            code = str(item['code'])
            name = str(item['name'])
            
            if code.startswith('6'):
                market = 'SH'
            elif code.startswith('0') or code.startswith('3'):
                market = 'SZ'
            elif code.startswith('4') or code.startswith('8'):
                market = 'BJ'
            else:
                market = 'SH'
            
            stocks.append({
                'code': code,
                'name': name,
                'market': market,
                'industry': '未知',
                'sector': '未知',
                'fullName': name
            })
        
        return stocks
    except Exception as e:
        print(f'获取数据失败: {e}', file=sys.stderr)
        return None

def main():
    output_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
    output_file = os.path.join(output_dir, 'stocks-database.json')
    
    os.makedirs(output_dir, exist_ok=True)
    
    stocks = fetch_stock_data()
    
    if stocks:
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(stocks, f, ensure_ascii=False, indent=2)
        print(f'数据已保存到: {output_file}')
        print(f'共 {len(stocks)} 只股票')
    else:
        print('使用备用数据...')
        sys.exit(1)

if __name__ == '__main__':
    main()
