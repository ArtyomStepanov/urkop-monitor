let layer=null,hiddenRow=null,flight=null;

export function clearRowMotion(tbody){
 if(flight)flight.cancel();flight=null;
 layer?.remove();layer=null;
 if(hiddenRow)hiddenRow.style.visibility='';hiddenRow=null;
 for(const row of tbody.rows)row.getAnimations().forEach(animation=>animation.cancel());
}

export function captureRowPositions(scroller,tbody){
 clearRowMotion(tbody);
 const top=scroller.getBoundingClientRect().top;
 return new Map([...tbody.rows].map(row=>[row.dataset.teamId,row.getBoundingClientRect().top-top+scroller.scrollTop]));
}

export function animateRows({table,scroller,from,activeId,follow,duration=600}){
 const tbody=table.tBodies[0],row=[...tbody.rows].find(row=>row.dataset.teamId===activeId);
 if(!row)return;
 let box=scroller.getBoundingClientRect();
 const contentTop=tr=>tr.getBoundingClientRect().top-box.top+scroller.scrollTop;
 const destination=contentTop(row),origin=from.get(activeId)??destination;
 if(follow){const center=(origin+destination)/2+row.getBoundingClientRect().height/2;scroller.scrollTop=Math.max(0,center-scroller.clientHeight/2);box=scroller.getBoundingClientRect();}
 if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 for(const other of tbody.rows){
  if(other===row)continue;
  const old=from.get(other.dataset.teamId),now=contentTop(other),delta=old-now,rect=other.getBoundingClientRect();
  if(old!==undefined&&Math.abs(delta)>1&&Math.abs(delta)<scroller.clientHeight*3&&rect.bottom>box.top&&rect.top<box.bottom)other.animate([{transform:'translateY('+delta+'px)'},{transform:'translateY(0)'}],{duration,easing:'ease-in-out'});
 }
 if(Math.abs(origin-destination)<1)return;
 const headerHeight=table.tHead?.getBoundingClientRect().height??0;
 layer=document.createElement('div');layer.className='moving-team-layer';layer.setAttribute('aria-hidden','true');
 layer.style.left=box.left+'px';layer.style.top=box.top+headerHeight+'px';layer.style.width=scroller.clientWidth+'px';layer.style.height=Math.max(0,scroller.clientHeight-headerHeight)+'px';
 const copy=document.createElement('table');copy.className='score-table flying-team';copy.style.cssText=table.style.cssText;copy.style.left=table.getBoundingClientRect().left-box.left+'px';copy.style.top=origin-scroller.scrollTop-headerHeight+'px';
 const cols=document.createElement('colgroup');for(const cell of row.cells){const col=document.createElement('col');col.style.width=cell.getBoundingClientRect().width+'px';cols.append(col);}
 const body=document.createElement('tbody'),clone=row.cloneNode(true);clone.classList.add('active-row');clone.removeAttribute('data-team-id');clone.querySelectorAll('button').forEach(button=>button.tabIndex=-1);body.append(clone);copy.append(cols,body);layer.append(copy);document.body.append(layer);
 hiddenRow=row;row.style.visibility='hidden';
 const currentLayer=layer,currentRow=row;
 flight=copy.animate([{transform:'translateY(0)'},{transform:'translateY('+(destination-origin)+'px)'}],{duration,easing:'ease-in-out',fill:'forwards'});
 flight.finished.then(()=>{currentLayer.remove();currentRow.style.visibility='';if(layer===currentLayer){layer=null;hiddenRow=null;flight=null;}}).catch(()=>{});
}
