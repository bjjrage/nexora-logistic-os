import test from 'node:test';
import assert from 'node:assert/strict';
import {checkLogin,passwordHash} from '../server/auth.ts';

test('login: usuario desconocido ejecuta la misma verificación scrypt y siempre falla', () => {
 const stored=passwordHash('correcta-123');
 assert.equal(checkLogin('correcta-123',stored),true);
 assert.equal(checkLogin('otra',stored),false);
 assert.equal(checkLogin('correcta-123',undefined),false);
 const time=(fn:()=>void)=>{const start=process.hrtime.bigint();for(let i=0;i<5;i++)fn();return Number(process.hrtime.bigint()-start)/1e6;};
 const known=time(()=>checkLogin('incorrecta',stored)),unknown=time(()=>checkLogin('incorrecta',undefined));
 assert.ok(unknown>known*0.5,`el camino de usuario inexistente es demasiado rápido (${unknown}ms vs ${known}ms)`);
});

test('contraseñas de 6 caracteres se aceptan y de 5 se rechazan (mínimo temporal para pruebas)',async()=>{
 const {schemas}=await import('../server/validation.ts');
 const base={commandId:crypto.randomUUID(),name:'QA',username:'qa.corta',role:'DEPOT'};
 assert.ok(schemas.user.safeParse({...base,password:'123456'}).success);
 assert.ok(!schemas.user.safeParse({...base,password:'12345'}).success);
});
