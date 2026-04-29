import os
import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
from bs4 import BeautifulSoup
from urllib.parse import urljoin
from dotenv import load_dotenv

# Cargamos las variables de entorno
load_dotenv()

app = FastAPI(title="Fix Scraper API")

# Obtenemos cookies del archivo .env
COOKIES = {
    'dle_user_id': os.getenv('DLE_USER_ID'),
    'dle_password': os.getenv('DLE_PASSWORD')
}

@app.get("/download")
async def download(game: str = Query(..., description="Nombre del juego")):
    url_busqueda = f'https://uploads.online-fix.me:2053/uploads/{game.replace(" ", "%20")}/Fix%20Repair/'
    
    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://online-fix.me/'
    })
    session.cookies.update(COOKIES)

    try:
        # 1. Handshake
        session.get("https://online-fix.me/", timeout=10)
        response = session.get(url_busqueda, timeout=10)

        if response.status_code != 200:
            raise HTTPException(status_code=404, detail=f"No se encontró el directorio. Status: {response.status_code}")

        # 2. Buscar el archivo 
        soup = BeautifulSoup(response.text, 'html.parser')
        links = soup.find_all('a', href=True)
        
        target_file_url = None
        for link in links:
            href = link['href']
            if href != "../":
                target_file_url = urljoin(url_busqueda, href)
                break 

        if not target_file_url:
            raise HTTPException(status_code=404, detail="No se encontró ningún archivo .rar o zip")

        def iterfile():
            with session.get(target_file_url, stream=True, timeout=300) as r:
                r.raise_for_status()
                for chunk in r.iter_content(chunk_size=512 * 1024): # 512KB chunks
                    if chunk:
                        yield chunk

        file_name = target_file_url.split('/')[-1]
        

        return StreamingResponse(
            iterfile(),
            media_type='application/octet-stream',
            headers={"Content-Disposition": f"attachment; filename={file_name}"}
        )

    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=500, detail=f"Error de conexión: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)