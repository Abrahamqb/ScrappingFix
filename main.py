import os
import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
from bs4 import BeautifulSoup
from urllib.parse import urljoin
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Fix Scraper API")

COOKIES = {
    'dle_user_id': os.getenv('DLE_USER_ID'),
    'dle_password': os.getenv('DLE_PASSWORD')
}

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://online-fix.me/'
}

@app.get("/download")
async def download(game: str = Query(..., description="Nombre del juego")):
    url_busqueda = f'https://uploads.online-fix.me:2053/uploads/{game.replace(" ", "%20")}/Fix%20Repair/'
    
    session = requests.Session()
    session.headers.update(HEADERS)
    session.cookies.update(COOKIES)

    try:
        # Handshake inicial
        session.get("https://online-fix.me/", timeout=10)
        response = session.get(url_busqueda, timeout=10)

        if response.status_code != 200:
            raise HTTPException(status_code=404, detail="Directory not found")

        soup = BeautifulSoup(response.text, 'html.parser')
        links = soup.find_all('a', href=True)
        
        target_file_url = None
        for link in links:
            href = link['href']
            if href != "../":
                target_file_url = urljoin(url_busqueda, href)
                break 

        if not target_file_url:
            raise HTTPException(status_code=404, detail="No RAR/ZIP file found")

        # OBTENER TAMAÑO TOTAL (Crítico para que C# no cierre la conexión antes)
        head_res = session.head(target_file_url, allow_redirects=True)
        total_size = head_res.headers.get('content-length')

        def iterfile():
            # Abrimos una nueva petición de stream
            with session.get(target_file_url, stream=True, timeout=600) as r:
                r.raise_for_status()
                for chunk in r.iter_content(chunk_size=1024 * 1024): # Chunks de 1MB
                    if chunk:
                        yield chunk

        file_name = target_file_url.split('/')[-1]
        
        custom_headers = {
            "Content-Disposition": f"attachment; filename={file_name}",
            "Accept-Ranges": "bytes"
        }
        if total_size:
            custom_headers["Content-Length"] = total_size

        return StreamingResponse(
            iterfile(),
            media_type='application/octet-stream',
            headers=custom_headers
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
