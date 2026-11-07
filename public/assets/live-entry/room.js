import { reconnectTrip } from './api.js';

(()=>{'use strict';const $=id=>document.getElementById(id);
$('handoff-title').textContent='여행방 정보를 불러오고 있어요.';
$('handoff-description').textContent='잠시만 기다려 주세요.';$('room-summary').hidden=true;
$('copy-code').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('handoff-code').textContent);$('copy-status').textContent='초대 코드를 복사했어요.';}catch{$('copy-status').textContent='코드를 직접 선택해 복사해 주세요.';}});
(async()=>{
try{
 const id=new URLSearchParams(location.search).get('tripId');if(!id)throw new Error('여행방을 선택해 주세요.');
 const data=await reconnectTrip(id);
 $('handoff-title').textContent='여행방에 들어왔어요.';
 $('handoff-description').textContent='서버에 저장된 방 정보예요. 초대 코드를 공유해 함께할 사람을 초대하세요.';
 $('handoff-name').textContent=data.trip.name;$('handoff-code').textContent=data.trip.inviteCode;$('handoff-nickname').textContent=data.member.nickname;$('room-summary').hidden=false;
 const note=document.querySelector('.boundary');if(note)note.textContent='방 생성·참여·재접속까지 연결한 확인용 화면이에요. 인원과 여행 조건은 다음 작업에서 추가합니다.';
}catch(error){$('handoff-title').textContent='여행방에 들어가지 못했어요.';$('handoff-description').textContent=error.message;}
})();})();