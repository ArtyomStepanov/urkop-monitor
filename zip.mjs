export function decodeText(bytes) {
  try { return new TextDecoder('utf-8',{fatal:true}).decode(bytes); }
  catch { return new TextDecoder('windows-1251').decode(bytes); }
}

function crc32(bytes) {
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}

export async function readTimusZip(input) {
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  const bad=()=>new Error('ZIP повреждён или имеет неподдерживаемый формат. Выберите исходный ZIP с full.log и teams.txt.');
  if(bytes.length<22||bytes.length>32_000_000)throw bad();
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){
    if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===bytes.length){end=i;break;}
  }
  if(end<0||view.getUint16(end+4,true)!==0||view.getUint16(end+6,true)!==0)throw bad();
  const count=view.getUint16(end+10,true),centralSize=view.getUint32(end+12,true),centralStart=view.getUint32(end+16,true);
  if(count>10000||centralStart+centralSize>end)throw bad();
  let offset=centralStart;
  const files=new Map();
  for(let i=0;i<count;i++){
    if(offset+46>end||view.getUint32(offset,true)!==0x02014b50)throw bad();
    const flags=view.getUint16(offset+8,true),method=view.getUint16(offset+10,true),crc=view.getUint32(offset+16,true);
    const packed=view.getUint32(offset+20,true),size=view.getUint32(offset+24,true),nameLen=view.getUint16(offset+28,true);
    const extraLen=view.getUint16(offset+30,true),commentLen=view.getUint16(offset+32,true),local=view.getUint32(offset+42,true);
    const next=offset+46+nameLen+extraLen+commentLen;
    if(next>centralStart+centralSize)throw bad();
    const filename=new TextDecoder().decode(bytes.subarray(offset+46,offset+46+nameLen)).replaceAll('\\','/');
    const basename=filename.split('/').at(-1).toLowerCase();
    if(basename==='full.log'||basename==='teams.txt'){
      if(files.has(basename))throw new Error(`В ZIP несколько файлов ${basename}. Оставьте один комплект логов.`);
      if((flags&1)!==0)throw new Error('ZIP защищён паролем. Распакуйте full.log и teams.txt и выберите их напрямую.');
      if(size>(basename==='full.log'?16_000_000:4_000_000)||local+30>centralStart)throw bad();
      if(view.getUint32(local,true)!==0x04034b50)throw bad();
      const start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true);
      if(start+packed>centralStart)throw bad();
      const payload=bytes.slice(start,start+packed);
      let unpacked;
      if(method===0)unpacked=payload;
      else if(method===8){
        if(typeof DecompressionStream==='undefined')throw new Error('Браузер не поддерживает распаковку ZIP. Выберите full.log и teams.txt напрямую.');
        try{
          const reader=new Blob([payload]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
          const chunks=[];let total=0;
          while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>size){await reader.cancel();throw bad();}chunks.push(value);}
          unpacked=new Uint8Array(total);let at=0;for(const chunk of chunks){unpacked.set(chunk,at);at+=chunk.length;}
        }catch(error){if(error.message?.includes('ZIP'))throw error;throw bad();}
      }else throw new Error('Этот способ сжатия ZIP не поддерживается. Выберите full.log и teams.txt напрямую.');
      if(unpacked.length!==size||crc32(unpacked)!==crc)throw bad();
      files.set(basename,decodeText(unpacked));
    }
    offset=next;
  }
  if(!files.has('full.log'))throw new Error('В ZIP не найден full.log. Нужен архив логов Тимуса, а не архив исходников решений.');
  return {log:files.get('full.log'),teams:files.get('teams.txt')??''};
}
