const express = require('express');
const cors = require('cors');
const app = express();
const bodyParser = require('body-parser');
const serverPort = 5000;
client=require('./config/db.js')

client.connect(err => {
    if (err) {
        console.log('Failed to connect db ' + err)
    } else {
        console.log('Connect to db done!')
    }
})
app.use(cors({origin: 'http://localhost:3000'})); // 클라이언트 주소를 허용
app.use(bodyParser.json());
app.use(express.json());

//건물명을 아이디로 변환해주는 함수
async function str2id(userReq1) {
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
        alert("입력한 장소가 존재하지 않습니다.새로고침하세요.");
        throw error;
    }
}



//3월 16일
function generateCaseCondition(userReq) {
    let conditions = [];

    if (userReq.features.bol) { //볼라드
        conditions.push("start_node.node_att = 1 or end_node.node_att = 1");
    }
    if (userReq.features.unpaved) { //비포장
        conditions.push("link.link_att = 4");
    }
    if (userReq.features.stairs) { //계단
        conditions.push("link.link_att = 5");
    }
    if (userReq.features.slope) { //경사
        conditions.push("link.grad_deg > 3.18");
    }
    if (userReq.features.bump) { //도로턱
        conditions.push("start_node.bump_hei > 2 or end_node.bump_hei > 2");
    }

    let caseCondition = conditions.length > 0
        ? `CASE WHEN ${conditions.join(" OR ")} THEN 10000 ELSE slopel END as cost`
        : "slopel as cost";

    return caseCondition;
}



async function findPathAsync(requestData) {
    try {
        const userReq1 = requestData; //살려야하는 부분
        const userReqNum = await str2id(userReq1); //
        const costCondition = generateCaseCondition(userReq1);

        let totalRoutes = []; // 전체 경로를 저장할 배열
        let totalCost = 0; // 전체 경로의 비용 합산

        // 각 경로 세그먼트(출발지에서 경유지1, 경유지1에서 경유지2, ..., 마지막 경유지에서 도착지)에 대해 최단 경로 계산
        for (let i = 0; i < userReqNum.length - 1; i++) {
            let segmentStartIds = userReqNum[i].join(',');
            let segmentEndIds = userReqNum[i + 1].join(',');


            const queryString = `
                WITH RouteCosts AS (SELECT pd.seq,
                                           pd.path_seq,
                                           pd.node,
                                           pd.edge,
                                           pd.cost,
                                           pd.agg_cost,
                                           pd.end_vid,
                                           n.node_att,
                                           n.bol_width,
                                           n.bump_hei,
                                           l.link_att,
                                           l.grad_deg,
                                           target_id,
                                           ST_AsText(n.node_geom) as node_geom,
                                           ST_AsText(l.link_geom) as link_geom,
                                           source_id

                                    FROM (SELECT *,
                                                 (ARRAY[${segmentStartIds}])[rn] as source_id,
                                                             (ARRAY[${segmentEndIds}])[rn] as target_id
                                          FROM
                                              pgr_dijkstra(
                                                  'SELECT id, node1 as source, node2 as target, ${costCondition}
                                              FROM
                                                (SELECT
                                                    id, link_att, grad_deg, length, node1, node2, slopel,
                                                    start_node.node_id as start_node_id, end_node.node_id as end_node_id,
                                                    start_node.node_att as start_node_att, end_node.node_att as end_node_att,
                                                    start_node.bol_width as start_bol_width, end_node.bol_width as end_bol_width,
                                                    start_node.bump_hei as start_bump_hei, end_node.bump_hei as end_bump_hei
                                                FROM "link" AS link
                                                INNER JOIN node AS start_node ON link.node1 = start_node.node_id
                                                INNER JOIN node AS end_node ON link.node2 = end_node.node_id) 
                                              as link', ARRAY[${segmentStartIds}], ARRAY[${segmentEndIds}], false
                                              ) as pd, generate_series(1, array_length(ARRAY[${segmentStartIds}], 1)) as rn, generate_series(1, array_length(ARRAY[${segmentEndIds}], 1)) as cn
                                          WHERE
                                              pd.start_vid = (ARRAY[${segmentStartIds}])[rn]
                                            AND
                                              pd.end_vid = (ARRAY[${segmentEndIds}])[cn]) as pd
                                             JOIN link as l ON pd.edge = l.id
                                             JOIN node as n ON pd.end_vid = n.node_id),
                     AggregatedCosts AS (SELECT source_id,
                                                target_id,
                                                SUM(agg_cost) as total_agg_cost
                                         FROM RouteCosts
                                         GROUP BY source_id,
                                                  target_id),
                     MinCostRoute AS (SELECT source_id, target_id
                                      FROM AggregatedCosts
                                      ORDER BY total_agg_cost
                    LIMIT 1
                    )
                SELECT rc.*
                FROM RouteCosts rc
                         INNER JOIN MinCostRoute mcr ON rc.source_id = mcr.source_id AND rc.target_id = mcr.target_id;
            `;

        }
        //추가 3월 15일 (끝)
        // 모든 계산 후 최종 결과
        const queryResult = await client.query(queryString);
        // 여기서는 각 세그먼트의 결과가 하나의 경로만을 반환하므로, 직접적인 합산 대신 결과 처리
        if (queryResult.rows.length > 0) {
            totalRoutes.push(queryResult.rows);
            // 쿼리 결과에서 마지막 행의 agg_cost는 해당 세그먼트의 총 비용입니다.
            totalCost += queryResult.rows[queryResult.rows.length - 1].agg_cost;
        }
        return [totalCost, ;
    } catch (error) {
        console.error('Error during POST request:', error);
        throw error;
    }
}

app.post('/findPathServer', async (req, res) => {
    try {
        const request = req.body; // 클라이언트에서 받은 requestData
        const result = await findPathAsync(request);
        // 결과를 클라이언트에게 응답
        res.json(result);
    } catch (error) {
        // 오류 처리
        console.error('Error during POST request:', error);
        res.status(500).json({error: 'Internal Server Error'});
    }
});
// 서버 시작
app.listen(serverPort, () => {
    console.log(`Server is running on port ${serverPort}`);
});
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something went wrong!');
});
