import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {providerReference,gatewayReference} from '../src/provider';
test('provider references preserve full UUID identity within the 32-character limit',()=>{
 for(let i=0;i<100;i++){const id=randomUUID(),ref=providerReference(id);assert.match(ref,/^[a-f0-9]{32}$/);assert.equal(gatewayReference(ref),id);assert.equal(gatewayReference(id),id);assert.equal(gatewayReference(ref.toUpperCase()),id);}
 for(const id of ['', 'x'.repeat(32), 'a'.repeat(31), 'a'.repeat(33), '12345678-1234-1234-1234-12345678901x']){assert.throws(()=>gatewayReference(id));assert.throws(()=>providerReference(id));}
});
