import net from 'node:net';
import assert from 'node:assert/strict';
import { parseProfileScript, formatSaleComment, generateResellerCode, isLimitUptime } from './hmp.js';
import { encodeSentence, takeSentence } from './protocol.js';
import { createHotspotUser, fetchProfiles } from './mikrotik.js';

const script = `:put (",remc,100,24h,100,,Disable,Disable,");
:local mode "X";
:local hmpv "v4-ros67";
{
  :local date [:tostr [/system clock get date]];
  :local time [:tostr [/system clock get time]];
  :local comment [/ip hotspot user get [/ip hotspot user find where name="$user"] comment];
  :local ucode [:pick $comment 0 2];
  :if ($ucode = "vc" or $ucode = "up" or $comment = "") do={
    :do { /system scheduler remove [find where name="$user"] } on-error={};
    :do {
      /system scheduler add name="$user" disabled=no start-date="$date" start-time="$time" interval="24h";
      :delay 2s;
      :local exp [:tostr [/system scheduler get [find where name="$user"] next-run]];
      :local getxp [:len $exp];
      :if ($getxp = 8) do={
        /ip hotspot user set comment="$date $exp $mode" [find where name="$user"];
      } else={
        :if (($getxp = 15) and ([:pick $exp 3 4] = "/")) do={
          :local d [:pick $exp 0 6];
          :local t [:pick $exp 7 16];
          :local yearISO "";
          :if (([:len $date] = 10) and ([:pick $date 4 5] = "-")) do={
            :set yearISO [:pick $date 0 4];
          } else={
            :set yearISO [:pick $date 7 11];
          };
          :local exp ("$d/$yearISO $t");
          /ip hotspot user set comment="$exp $mode" [find where name="$user"];
        } else={
          :if ($getxp > 0) do={
            /ip hotspot user set comment="$exp $mode" [find where name="$user"];
          };
        };
      };
    } on-error={};
    :do { /system scheduler remove [find where name="$user"] } on-error={};
  :local months ("jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec");
  :local year "";
  :local month "";
  :if (([:len $date] = 10) and ([:pick $date 4 5] = "-")) do={
    :set year [:pick $date 0 4];
    :set month [:pick $date 5 7];
  } else={
    :set year [:pick $date 7 11];
    :local monstr [:pick $date 0 3];
    :local monthint [:find $months $monstr];
    :set month ($monthint + 1);
    :if ($month < 10) do={
      :set month ("0" . $month);
    } else={
      :set month [:tostr $month];
    }
  };
  :local owner ("$month$year");
    :local mac $"mac-address";
    /system script add name="$date-|-$time-|-$user-|-100-|-$address-|-$mac-|-24h-|-3H-|-$comment" owner="$owner" source=$date comment=hmp
  };
};
`;

const parsed = parseProfileScript(script);
assert.equal(parsed.price, 100);
assert.equal(parsed.validity, '24h');
assert.equal(parsed.uptimeHint, '3H');
assert.equal(isLimitUptime('3h'), true);
assert.equal(isLimitUptime('24h'), true);
assert.equal(isLimitUptime('3 heures'), false);

const comment = formatSaleComment({
  code: '864',
  name: 'GOGOUNA',
  date: new Date('2025-03-11T12:00:00Z'),
  timeZone: 'UTC',
});
assert.equal(comment, 'vc-864-11.03.25-GOGOUNA');
const generated = generateResellerCode(['864', '856']);
assert.match(generated, /^\d{3,}$/);
assert.notEqual(generated, '864');
assert.notEqual(generated, '856');

const roundtrip = { buf: Buffer.concat([encodeSentence(['!re', `=on-login=${script}`])]) };
const words = takeSentence(roundtrip);
assert.equal(words[1], `=on-login=${script}`);
assert.equal(roundtrip.buf.length, 0);
const partial = { buf: encodeSentence(['/login']).subarray(0, 2) };
assert.equal(takeSentence(partial), null);

const seen = [];
const server = net.createServer((socket) => {
  const state = { buf: Buffer.alloc(0) };
  socket.on('data', (chunk) => {
    state.buf = Buffer.concat([state.buf, chunk]);
    let sentence = takeSentence(state);
    while (sentence) {
      seen.push(sentence);
      if (sentence[0] === '/login') {
        socket.write(encodeSentence(['!done']));
      } else if (sentence[0] === '/ip/hotspot/user/profile/print') {
        socket.write(encodeSentence([
          '!re',
          '=name=3h',
          `=on-login=${script}`,
          '=rate-limit=512k/2M',
        ]));
        socket.write(encodeSentence(['!done']));
      } else if (sentence[0] === '/ip/hotspot/user/add') {
        socket.write(encodeSentence(['!done']));
      } else if (sentence[0] === '/ip/hotspot/user/print') {
        socket.write(encodeSentence(['!done']));
      } else {
        socket.write(encodeSentence(['!trap', '=message=unexpected']));
      }
      sentence = takeSentence(state);
    }
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const router = { host: '127.0.0.1', port, username: 'api', password: 'secret' };

const profiles = await fetchProfiles(router);
assert.equal(profiles.length, 1);
assert.equal(profiles[0].name, '3h');
assert.equal(parseProfileScript(profiles[0].onLogin).price, 100);
assert.equal(parseProfileScript(profiles[0].onLogin).uptimeHint, '3H');
assert.equal(profiles[0].rateLimit, '512k/2M');

await createHotspotUser(router, {
  name: 'cpr732',
  password: 'cpr732',
  profile: '3h',
  limitUptime: '3h',
  comment: 'vc-864-11.03.25-GOGOUNA',
});

const added = seen.find((sentence) => sentence[0] === '/ip/hotspot/user/add');
assert.ok(added.includes('=name=cpr732'));
assert.ok(added.includes('=password=cpr732'));
assert.ok(added.includes('=profile=3h'));
assert.ok(added.includes('=limit-uptime=3h'));
assert.ok(added.includes('=comment=vc-864-11.03.25-GOGOUNA'));
const login = seen.find((sentence) => sentence[0] === '/login');
assert.ok(login.includes('=name=api'));
assert.ok(login.includes('=password=secret'));

server.close();
console.log('selfcheck ok');
