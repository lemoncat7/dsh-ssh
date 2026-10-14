import test from 'node:test'
import assert from 'node:assert/strict'
import {explorerStateKey,readExplorerState,saveExplorerState} from '../lib/explorer-state.js'

test('explorer locations and opened files are isolated by session and host',()=>{
 const a=explorerStateKey('s1','host'),b=explorerStateKey('s2','host'),local=explorerStateKey('s1')
 const file={path:'/a/schema.sql',name:'schema.sql',kind:'file',size:10,modifiedAt:1}
 saveExplorerState(a,{directory:'/a',openedFile:file,scrollTop:80})
 saveExplorerState(b,{directory:'/b',scrollTop:0});saveExplorerState(local,{directory:'/local',scrollTop:5})
 file.name='mutated'
 assert.equal(readExplorerState(a).openedFile.name,'schema.sql')
 assert.equal(readExplorerState(a).scrollTop,80);assert.equal(readExplorerState(b).directory,'/b');assert.equal(readExplorerState(local).directory,'/local')
 assert.notEqual(explorerStateKey('a:b','c'),explorerStateKey('a','b:c'))
 saveExplorerState(undefined,{directory:'/ignored',scrollTop:0});assert.equal(readExplorerState(undefined),undefined)
})
test('navigation metadata cache is bounded',()=>{
 const first=explorerStateKey('oldest')
 saveExplorerState(first,{directory:'/',scrollTop:0})
 for(let i=0;i<128;i++)saveExplorerState(explorerStateKey('s'+i),{directory:'/',scrollTop:0})
 assert.equal(readExplorerState(first),undefined)
})
