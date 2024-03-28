const express = require('express');
const cors = require('cors');
const app = express();
const bodyParser = require('body-parser');
const {continueSession} = require("pg/lib/crypto/sasl");
const serverPort = 5000;
const NODE_Frontend_URL = 'http://localhost:3000'
client=require('./config/db.js')

client.connect(err => {
    if (err) {
        console.log('Failed to connect db ' + err)
    } else {
        console.log('Connect to db done!')
    }
})
app.use(cors({origin: NODE_Frontend_URL})); // 클라이언트 주소를 허용
app.use(bodyParser.json());
app.use(express.json());

//건물명을 아이디로 변환해주는 함수
async function str2id(userReq1) {
    try {
        let AllPoints = [];
        var str2idQuery = 'SELECT node_id from "node" WHERE  "node".build_name = $1';
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
        //alert("입력한 장소가 존재하지 않습니다.새로고침하세요.");
        throw error;
    }
}

function createVariations(arrays, currentIndex, currentVariation, result) {
    if (currentIndex === arrays.length) {
        result.push([...currentVariation]);
        return;
    }
    for (let i = 0; i < arrays[currentIndex].length; i++) {
        currentVariation[currentIndex] = arrays[currentIndex][i];
        createVariations(arrays, currentIndex + 1, currentVariation, result);
    }
}

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
        const userReqNum = await str2id(userReq1); //
        const costCondition = generateCaseCondition(userReq1);


        try {

            const AllPointsPath = [];
            createVariations(userReqNum, 0, [], AllPointsPath);
            //console.log('AllPointsPath:',AllPointsPath);
            const AllPaths = [];
            for (let j = 0; j < AllPointsPath.length; j++) {
                AllPaths[j] = [];
                for (let i = 0; i < AllPointsPath[j].length - 1; i++) {
                    const sourceNode = AllPointsPath[j][i];
                    const targetNode = AllPointsPath[j][i + 1];
                    try {
                        const queryresult = await client.query(`SELECT pd.seq,
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
                                                 (ARRAY[${sourceNode}])[rn] as source_id,
                                                 (ARRAY[${targetNode}])[cn] as target_id
                                        FROM
                                            pgr_dijkstra
                                            (
                                                'SELECT id, node1 as source, node2 as target, ${costCondition}
                                                FROM link_with_node',
                                                ARRAY[${sourceNode}], ARRAY[${targetNode}], false
                                            ) as pd,
                                            generate_series(1, array_length(ARRAY[${sourceNode}], 1)) as rn,
                                            generate_series(1, array_length(ARRAY[${targetNode}], 1)) as cn
                                            WHERE
                                                pd.start_vid = (ARRAY[${sourceNode}])[rn]
                                            AND
                                                pd.end_vid = (ARRAY[${targetNode}])[cn]
                                        ) as pd
                                        LEFT JOIN link as l ON pd.edge = l.id
                                        JOIN node as n ON pd.end_vid = n.node_id
                        `);
                        AllPaths[j][i] = queryresult.rows
                    } catch (error) {
                        console.error("Error executing query:", error);
                    }
                }
            }
            //console.log(AllPaths.length);
            const sumAggCosts = AllPaths.map(pathGroup => {
                return pathGroup.reduce((sum, path) => {
                    const aggCosts = path
                        .filter(step => step.edge === '-1')
                        .map(step => step.agg_cost);

                    return sum + aggCosts.reduce((innerSum, cost) => innerSum + cost, 0);
                }, 0);
            });
            //console.log(sumAggCosts);
            const minAggCost = Math.min(...sumAggCosts);
            const minAggCostIndex = sumAggCosts.indexOf(minAggCost);
            let shortestPath = AllPaths[minAggCostIndex];
            console.log(shortestPath);
            if ( minAggCost >= 10000) {
                // 유효하지 않은 입력에 대한 처리, 예: 경로 데이터나 totalDistance 값을 null로 설정
                return { shortestPath: 0, minAggCost: 0 };
            }

            return {shortestPath, minAggCost};

        } catch (error) {
            console.error('임시 테이블 생성 중 오류:', error);
            throw error; // 높은 catch 블록에서 잡힐 오류를 다시 던집니다.
        }
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
async function ShowReqAsync(requestDatatype) {
    try {
        let Id4ShowQuery = '';
        if (requestDatatype.Req === 'facilities') {
            Id4ShowQuery = 'SELECT node_id FROM "node" WHERE node_att = 8';
        }
        else if (requestDatatype.Req === 'unpaved') {
            Id4ShowQuery ='SELECT id FROM "link" WHERE link_att = 4';
        }
        else if (requestDatatype.Req === 'stairs') {
            Id4ShowQuery ='SELECT id FROM "link" WHERE link_att = 5';
        }
        else if (requestDatatype.Req === 'slope') {
            Id4ShowQuery ='SELECT id FROM "link" WHERE grad_deg >= 3.18';
        }
        else if (requestDatatype.Req === 'bump') {
            Id4ShowQuery ='SELECT node_id FROM "node" WHERE node_att = 3';
        }
        else if (requestDatatype.Req === 'bol') {
            Id4ShowQuery ='SELECT node_id FROM "node" WHERE node_att = 1';
        }
        const queryResults = await client.query(Id4ShowQuery);
        const A = queryResults.rows;
        let resultIds;
        if (requestDatatype.Req === 'facilities' || requestDatatype.Req === 'bump' || requestDatatype.Req === 'bol') {
            resultIds = A.map(item => Number(item.node_id));
        } else if (requestDatatype.Req === 'unpaved' || requestDatatype.Req === 'stairs'|| requestDatatype.Req === 'slope' ) {
            resultIds = A.map(item => Number(item.id));
        }
        return resultIds;
    } catch (error) {
        console.error('Error in ShowReqAsync:', error);
        throw error; // 높은 catch 블록에서 잡힐 오류를 다시 던집니다.
    }
}

app.post('/ShowReq', async (req, res) => {
    try {
        const Ids = await ShowReqAsync(req.body);
        res.json({ Ids }); // 클라이언트에게 편의시설/장애물종류별 ID 배열 전송
    } catch (error) {
        console.error('Error during POST request:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

async function GetBuildingInfoAsync(keyword) {
    const queryString = `SELECT b.bd_id, p.bg_name, p.type, b.summary, b.image_url, b.total_floor, b.lounge_count
                         FROM bd_info as b
                         INNER JOIN poi_point as p
                         ON b.bg_name = p.bg_name
                         WHERE p.bg_name = '${keyword}'`;
    const queryResult = await client.query(queryString);
    return queryResult;
}

app.post('/showBuildingInfo', async (req, res) => {
    try {
        const bgInfo = await findBuildingAsync(req.body);
        res.json(bgInfo);
    } catch (error) {
        console.error('Error during POST request:', error);
        res.status(500).json({error: 'Internal Server Error'});
    }
});

app.get('/', (req,res)=> {
    res.status(200).send('Server is running (:');
})
// 서버 시작
app.listen(process.env.PORT || serverPort, () => {
    console.log(`Server is running on port ${serverPort}`);
});
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something went wrong!');
});

