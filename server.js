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
        console.log('Cfonnect to db done!')
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

        // 시작점과 종료점에 대한 검증
        if (startResult.rows.length === 0 || endResult.rows.length === 0) {
            return null;
        }

        const start = startResult.rows.map(row => Number(row.node_id));
        const end = endResult.rows.map(row => Number(row.node_id));
        const stopovers = userReq1.stopovers || []; //falsy" 값(예: undefined, null, false, 0, NaN, "")일 경우 ([]) 반환.만약 userReq1.stopovers가 비어있지 않다면, 그 값을 그대로 사용

        if (stopovers.length === 0) {
            AllPoints = [start, end];
        } else {
            for (let i = 0; i < stopovers.length; i++) {
                const stopoversResult = await client.query(str2idQuery, [stopovers[i]]);
                stopovers[i] = stopoversResult.rows.map(row => Number(row.node_id));
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
        //alert("입력한 장소가 존재하지 않습니다.새로고침하세요.");
        throw error;
    }
}



//3월 16일
function generateCaseCondition(userReq) {
    let conditions = [];

    if (userReq.features.bol) { //볼라드
        conditions.push("start_node_att = 1 or end_node_att = 1");
    }
    if (userReq.features.unpaved) { //비포장
        conditions.push("link_att = 4");
    }
    if (userReq.features.stairs) { //계단
        conditions.push("link_att = 5");
    }
    if (userReq.features.slope) { //경사
        conditions.push("grad_deg >= 3.18");
    }
    if (userReq.features.bump) { //도로턱
        conditions.push("start_bump_hei >= 2 or end_bump_hei >= 2");
    }

    let caseCondition = conditions.length > 0
        ? `CASE WHEN ${conditions.join(" OR ")} THEN 10000 ELSE slopel END as cost`
        : "slopel as cost";

    return caseCondition;
}



async function findPathAsync(requestData) {
    try {
        const userReq1 = requestData; //살려야하는 부분
        const userReqNum = await str2id(userReq1); //배열 요소 하나=건물입구 배열
        const costCondition = generateCaseCondition(userReq1);

        if (userReqNum === null) {
            // 유효하지 않은 입력에 대한 처리, 예: 경로 데이터나 totalDistance 값을 null로 설정
            return { shortestPath: null, minAggCost: null };
        }

        let shortestPath = []; // 전체 경로를 저장할 배열
        let totalCost = 0; // 전체 경로의 비용 합산
        let minAggCost = 0; // 최소 비용 초기화

        /*
        for (let i = 0; i < userReqNum.length; i++) {
            console.log(userReqNum[i]);
        }
         */

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
                                           source_id,
                                           target_id,
                                           pd.end_vid,
                                           n.node_att,
                                           n.bol_width,
                                           n.bump_hei,
                                           l.link_att,
                                           l.slopel,
                                           l.grad_deg,
                                           ST_AsText(n.node_geom) as node_geom,
                                           ST_AsText(l.link_geom) as link_geom

                                    FROM (
                                        SELECT *,
                                                 (ARRAY[${segmentStartIds}])[rn] as source_id,
                                                 (ARRAY[${segmentEndIds}])[cn] as target_id
                                        FROM
                                            pgr_dijkstra
                                            (
                                                'SELECT id, node1 as source, node2 as target, ${costCondition}
                                                FROM link_with_node',
                                                ARRAY[${segmentStartIds}], ARRAY[${segmentEndIds}], false
                                            ) as pd,
                                            generate_series(1, array_length(ARRAY[${segmentStartIds}], 1)) as rn,
                                            generate_series(1, array_length(ARRAY[${segmentEndIds}], 1)) as cn
                                            WHERE
                                                pd.start_vid = (ARRAY[${segmentStartIds}])[rn]
                                            AND
                                                pd.end_vid = (ARRAY[${segmentEndIds}])[cn]
                                        ) as pd
                                        LEFT JOIN link as l ON pd.edge = l.id
                                        JOIN node as n ON pd.end_vid = n.node_id
                                    ),
                                    AggregatedCosts AS (SELECT source_id,
                                                               target_id,
                                                               SUM(cost) as total_agg_cost,
                                                               SUM(slopel) as total_slopel
                                                        FROM
                                                               RouteCosts
                                                        GROUP BY source_id,
                                                                 target_id),
                                    MinCostRoute AS (SELECT source_id, target_id, total_agg_cost
                                                     FROM
                                                        AggregatedCosts
                                                     ORDER BY
                                                        total_agg_cost
                                                        LIMIT 1
                                                    )
                                    SELECT rc.*, ac.total_slopel
                                    FROM
                                        RouteCosts rc
                                    INNER JOIN
                                        MinCostRoute mcr ON rc.source_id = mcr.source_id AND rc.target_id = mcr.target_id
                                    INNER JOIN
                                        AggregatedCosts ac ON mcr.source_id = ac.source_id AND mcr.target_id = ac.target_id
                                    WHERE ac.total_agg_cost < 10000;
                                `;


            //추가 3월 15일 (끝)
            // 모든 계산 후 최종 결과
            const queryResult = await client.query(queryString);
            // 여기서는 각 세그먼트의 결과가 하나의 경로만을 반환하므로, 직접적인 합산 대신 결과 처리
            if (queryResult.rows.length > 0) {
                shortestPath.push(queryResult.rows); // 각 세그먼트의 경로를 배열에 추가
                totalCost += queryResult.rows.reduce((acc, cur) => acc + cur.agg_cost, 0); // 세그먼트의 총 비용을 전체 비용에 더함

                // 쿼리 결과에서 total_slopel 추출 및 전체 slopel 값 업데이트
                let segmentSlopel = queryResult.rows[0].total_slopel; // 가정: 쿼리 결과의 첫 번째 행에 total_slopel 값이 포함
                minAggCost += segmentSlopel;
            }
        }
        // 최종 결과에 minAggCost 포함하여 반환 (코스트, 경로 배열, 길이)
        console.log(shortestPath);
        return { totalCost, shortestPath, minAggCost };

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
