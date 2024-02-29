const client = require('./config/db.js');

const str2id = async (userReq1) => {
    try {
        let AllPoints = [];
        var str2idQuery = 'SELECT node_id from "node" WHERE  "node"."bulid_name" = $1';
        const startResult = await client.query(str2idQuery, [userReq1.start]);
        const endResult = await client.query(str2idQuery, [userReq1.end]);
        const start = startResult.rows.map(row => Number(row.node_id));
        const end = endResult.rows.map(row => Number(row.node_id));
        const stopovers = userReq1.stopovers || []; //falsy" 값(예: undefined, null, false, 0, NaN, "")일 경우 ([]) 반환.만약 userReq1.stopovers가 비어있지 않다면, 그 값을 그대로 사용
        if (stopovers.length === 0) {
            AllPoints = [start, end];
        } else {
            for (let i = 0; i < stopovers.length; i++) {
                const stopoversResult = await client.query(str2idQuery, [stopovers[i]]);
                stopovers[i]=stopoversResult.rows.map(row => Number(row.node_id));
            }
            AllPoints = [start, ...stopovers, end];
        }
        //console.log('start:',start);
        //console.log('end:',end);
        //console.log('stopovers:',stopovers);
        //console.log('AllPoints:',AllPoints);
        return AllPoints;
    } catch (error) {
        console.error('str2id 함수 오류:', error);
        alert("입력한 장소가 존재하지 않습니다. 새로고침하세요.");
        throw error;
    }
};

module.exports = {
    str2id,
};
