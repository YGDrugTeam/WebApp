async function uploadImage(photo) {
    const box = new FormData();
    box.append('file', photo, 'pill.jpg');

    try {
        const answer = await axios.post('http://localhost:8000/analyze', box);
        const pillName = answer.data.pill_name; // 서버가 읽어준 약 이름

        console.log("인")
    }
}

const formData = new FormData();
formData.append('file', blobData, 'pill.jpg');
axios.post('http://localhost:8000/analyze', formData)

const uploadImage

async def

@app.post("/analyze")

contents = await file.read()

return (len(contents))