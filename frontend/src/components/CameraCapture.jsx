import React, { useRef, useEffect } from 'react'; // useRef를 꼭 불러와야 합니다!
import axios from 'axios';

// app.add_middleware

// allow_origins
// allow_credentials
// allow_methods
// allow_headers

const CameraCapture = () => {
    // 여기에 useRef 설정들이 있고...
    const videoRef = useRef(null);
    const canvasRef = useRef(null);

    // 카메라를 켜는 마법의 주문입니다.
    useEffect(() => {
        navigator.mediaDevices.getUserMedia({ video: true })
            .then((stream) => {
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                }
            })
            .catch((err) => console.error("카메라를 켤 수 없어요:", err));
    }, []); // 처음 한 번만 실행되도록 설정

    // --- 여기에 아까 작성하신 함수들을 넣어주세요 ---
    async function uploadImage(photo) {
    // 'async'가 붙었으니 이 안에서는 'await'를 쓸 수 있어요.

        const box = new FormData(); // 택배 박스를 준비해요.
        box.append('file', photo, 'pill.jpg'); // 박스에 사진을 넣고 'file'이라고 이름을 븥여요.

        try {
            // axios로 서버 주소에 박스를 보내고, 대답이 올 때까지 기다려요(await).
            const answer = await axios.post('http://localhost:8000/analyze', box);

            // 서버가 대답을 하면 콘솔창에 보여줘요.
            console.log("서버의 대답:", answer.data);

            const speak = (text) => {
                const message = new SpeechSynthesisUtterance(text);

                // 브라우저에서 목소리 목록을 가져옵니다.
                const voices = window.speechSynthesis.getVoices();

                // 한국어 여성 목소리(Sunhi)를 찾습니다.
                const womanVoice = voices.find(v => v.lang === 'ko-KR' && v.name.includes('SunHi'));

                if (womanVoice) {
                    message.voice = womanVoice;
                }

                window.speechSynthesis.speak(message);
            };

            // 위 함수를 사용해서 서버 응답 시점에 말하게 합니다.
            speak("사진을 성공적으로 보냈습니다. 분석 결과를 기다려 주세요.")

            // [힌트] 여기서 나중에 "분석이 끝났습니다"라고 여성 목소리가 나오게 할 거예요!
        } catch (error) {
            console.log("보내기 실패했어요ㅠㅠ", error);
        }
    }

    // 버튼을 눌렀을 때 실행될 '찰칵' 함수
    function handleCapture() {
        const canvas = canvasRef.current;
        const video = videoRef.current;
        if (!canvas || !video) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

        // 1단계: 비디오 화면을 캔버스에 그려요.
        // canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

        // 2단계: 캔버스 그림을 '파일'로 포장해요.
        canvas.toBlob((photo) => {
            if (photo) uploadImage(photo); // 포장이 끝나면 위에 만든 '배달' 함수에 넘겨줘요.
        }, 'image/jpeg');
    }

// const formData = new FormData();
// formData.append('file', blobData, 'pill.jpg');
// axios.post('http://localhost:8000/analyze', formData)

// // 이 구조를 따라가 보세요
// const response = await axios.post('http://localhost:8000/analyze', formData, {
//     headers: { 'Content-Type': 'multipart/form-data'}
// });

    return (
        <div>
            <video ref={videoRef} autoPlay playsInline style={{ width: '100%', maxWidth: '400px' }} />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            <br />
            <button onClick={handleCapture}>사진 찍기</button>
        </div>
    );
};

// @app.post("/analyze")

// contents = await file.read()

// return (len(contents))

export default CameraCapture; // 2. 내보내기