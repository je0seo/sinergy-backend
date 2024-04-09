//server.js

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
        let str2idQuery = 'SELECT node_id from "node" WHERE  "node".bulid_name = $1';
        let str2idQuery1 = `SELECT n.node_id
                           FROM node as n
                           JOIN convenient as c
                           ON n.conv_cate = c.conv_cate
                           WHERE c.description = $1`;
        let str2idQuery2 = 'SELECT node_id from "node" WHERE  "node".nickname = $1 OR "node".eng_name = $1';
        const startResult = await client.query(str2idQuery, [userReq1.start]);
        const endResult = await client.query(str2idQuery, [userReq1.end]);
        let start = startResult.rows.map(row => Number(row.node_id));
        let end = endResult.rows.map(row => Number(row.node_id));
        if (start.length === 0) {
            const startResult = await client.query(str2idQuery1, [userReq1.start]);
            start = startResult.rows.map(row => Number(row.node_id));
            if (start.length === 0) {
                if (start.length === 0) { //"출발지 convenient에도 없음. nick, eng에서 찾기 시작"
                    const startResult = await client.query(str2idQuery2, [userReq1.start]);
                    start = startResult.rows.map(row => Number(row.node_id));
                    if (start.length === 0) { return [0]; }
                }
            }
        }
        if (end.length === 0) { //"도착지 build_name에 없음"
            const endResult = await client.query(str2idQuery1, [userReq1.end]);
            end = endResult.rows.map(row => Number(row.node_id));
            if (end.length === 0) {
                const endResult = await client.query(str2idQuery2, [userReq1.end]);
                end = endResult.rows.map(row => Number(row.node_id));
                console.log('end:', end);
                if (end.length === 0) { return [0, 0]; }
            }
        }
        const stopovers = userReq1.stopovers || []; //falsy" 값(예: undefined, null, false, 0, NaN, "")일 경우 ([]) 반환.만약 userReq1.stopovers가 비어있지 않다면, 그 값을 그대로 사용
        if (stopovers.length === 0) { //애초에 경유지가 없는 경우
            AllPoints = [start, end];
        } else { //경유지 있는 경우
            let stopover = [];
            for (let i = 0; i < stopovers.length; i++) {
                let stopoversResult = await client.query(str2idQuery, [stopovers[i]]);
                stopover[i] = stopoversResult.rows.map(row => Number(row.node_id));
                if (stopover[i].length === 0) { //경유지가 build_name에 없는 경우 편의시설에서 확인
                    stopoversResult = await client.query(str2idQuery1, [stopovers[i]]);
                    stopover[i] = stopoversResult.rows.map(row => Number(row.node_id));
                    if (stopover[i].length === 0) { //경유지가 build_name에 없는데 편의시설도 아닌 경우
                        stopoversResult = await client.query(str2idQuery2, [stopovers[i]]);
                        stopover[i] = stopoversResult.rows.map(row => Number(row.node_id));
                    }
                }
            }
            AllPoints = [start, ...stopover, end];
        }
        console.log("AllPoints:", AllPoints);
        return AllPoints;
    } catch (error) {
        console.error('str2id 함수 오류:', error);
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
        conditions.push("grad_deg >= 3.18 AND link_att != 5");
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
        const userReqNum = await str2id(userReq1); // 이때, 출발지 없으면 [0], 도착지 없으면 [0,0]
        //console.log('userReqNum:', userReqNum);
        if (userReqNum === [0] || userReqNum === [0,0]){
            return { shortestPath: 0, minAggCost: 0 , userReqNum};
        }
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
            const minAggCost = Math.min(...sumAggCosts);
            const minAggCostIndex = sumAggCosts.indexOf(minAggCost);
            let shortestPath = AllPaths[minAggCostIndex];
            //console.log(shortestPath);
            if ( minAggCost >= 10000) {
                // 유효하지 않은 입력에 대한 처리, 예: 경로 데이터나 totalDistance 값을 null로 설정
                //console.log(userReqNum);
                return { shortestPath: 0, minAggCost: 0 , userReqNum};
            }
            return {shortestPath, minAggCost, userReqNum};
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
        let Id4ShowQuery = `SELECT c.node_id, c.image_url, c.summary
                           FROM conv_info as c
                           INNER JOIN node as n
                           ON c.node_id = n.node_id`;
        if (requestDatatype.Req === 'bench') { //벤치
            Id4ShowQuery += ` WHERE n.conv_cate = 0`;
        }
        else if (requestDatatype.Req === 'smoking') { //흡연 부스
            Id4ShowQuery += ` WHERE n.conv_cate = 1`;
        }
        else if (requestDatatype.Req === 'store') { //편의점
            Id4ShowQuery += ` WHERE n.conv_cate = 2`;
        }
        else if (requestDatatype.Req === 'bicycle') { //자전거거치대
            Id4ShowQuery += ` WHERE n.conv_cate = 3`;
        }
        else if (requestDatatype.Req === 'cafe') { // 카페
            Id4ShowQuery += ` WHERE n.conv_cate = 4`;
        }
        else if (requestDatatype.Req === 'atm') { //은행/atm
            Id4ShowQuery += ` WHERE n.conv_cate = 5`;
        }
        else if (requestDatatype.Req === 'postoffice') { //우체국
            Id4ShowQuery += ` WHERE n.conv_cate = 6`;
        }
        else if (requestDatatype.Req === 'healthservice') { //보건소
            Id4ShowQuery += ` WHERE n.conv_cate = 7`;
        }
        else if (requestDatatype.Req === 'cafeteria') { //학생식당
            Id4ShowQuery += ` WHERE n.conv_cate = 8`;
        }
        else if (requestDatatype.Req === 'print') { //복사실
            Id4ShowQuery += ` WHERE n.conv_cate = 9`;
        }
        else if (requestDatatype.Req === 'gym') { //헬스장
            Id4ShowQuery += ` WHERE n.conv_cate = 10`;
        }
        else if (requestDatatype.Req === 'tennis') { //테니스장
            Id4ShowQuery += ` WHERE n.conv_cate = 11`;
        }
        else if (requestDatatype.Req === 'basketball') { //농구장
            Id4ShowQuery += ` WHERE n.conv_cate = 12`;
        }
        else if (requestDatatype.Req === 'breakroom') { //휴게실
            Id4ShowQuery += ` WHERE n.conv_cate = 13`;
        }
        else if (requestDatatype.Req === 'lounge') { //학생라운지
            Id4ShowQuery += ` WHERE n.conv_cate = 14`;
        }
        else if (requestDatatype.Req === 'seminarroom') { //세미나실
            Id4ShowQuery += ` WHERE n.conv_cate = 15`;
        }
        else if (requestDatatype.Req === 'Sbicycle') { //따릉이대여소
            Id4ShowQuery += ` WHERE n.conv_cate = 16`;
        }
        else if (requestDatatype.Req === 'library') { //도서관
            Id4ShowQuery += ` WHERE n.conv_cate = 17`;
        }
        else if (requestDatatype.Req === 'vendingMachine') { //자판기
            Id4ShowQuery += ` WHERE n.conv_cate = 18`;
        }
        else if (requestDatatype.Req === 'facilities') {
            Id4ShowQuery += ` WHERE n.node_att = 8`;
        }
        else if (requestDatatype.Req === 'unpaved') {
            Id4ShowQuery ='SELECT id FROM "link" WHERE link_att = 4';
        }
        else if (requestDatatype.Req === 'stairs') {
            Id4ShowQuery ='SELECT id FROM "link" WHERE link_att = 5';
        }
        else if (requestDatatype.Req === 'slope') {
            Id4ShowQuery ='SELECT id FROM "link" WHERE grad_deg >= 3.18 AND link_att != 5';
        }
        else if (requestDatatype.Req === 'bump') {
            Id4ShowQuery ='SELECT node_id, image_nobs, bump_hei FROM "node" WHERE node_att = 3';
        }
        else if (requestDatatype.Req === 'bol') {
            Id4ShowQuery ='SELECT node_id, image_nobs, bol_width FROM "node" WHERE node_att = 1';
        }
        const queryResults = await client.query(Id4ShowQuery);
        const A = queryResults.rows;
        let ids;
        let images;
        let info;
        if (requestDatatype.Req === 'bump' || requestDatatype.Req === 'bol') {
            ids = A.map(item => Number(item.node_id));
            images = A.map(item => item.image_nobs);
            info = (requestDatatype.Req === 'bump') ? A.map(item => item.bump_hei) : A.map(item => item.bol_width);
        } else if (requestDatatype.Req === 'unpaved' || requestDatatype.Req === 'stairs'|| requestDatatype.Req === 'slope' ) {
            ids = A.map(item => Number(item.id));
            images = '';
            info = '';
        } else {
            console.log(requestDatatype.Req);
            ids = A.map(item => Number(item.node_id));
            console.log(ids);
            images = A.map(item => item.image_url);
            info = A.map(item => item.summary)
        }
        return {ids, images, info};
    } catch (error) {
        console.error('Error in ShowReqAsync:', error);
        throw error; // 높은 catch 블록에서 잡힐 오류를 다시 던집니다.
    }
}
app.post('/ShowReq', async (req, res) => {
    try {
        const data = await ShowReqAsync(req.body);
        res.json({ ids: data.ids, images: data.images, info: data.info}); // 클라이언트에게 편의시설/장애물종류별 ID, 이미지, 추가정보 배열 전송
    } catch (error) {
        console.error('Error during POST request:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

async function getBuildingInfoAsync(req) {
    const queryString = `SELECT b.bd_id, p.bg_name, p.type, b.summary, b.image_url,
                        b.total_floor, b.lounge_count, p.eng_name, p.nickname
                         FROM bd_info as b
                         INNER JOIN poi_point as p
                         ON b.bg_name = p.bg_name
                         WHERE p.bg_name LIKE '%${req.keyword}%'
                         OR p.nickname LIKE '${req.keyword}'
                         OR UPPER(p.eng_name) LIKE UPPER('%${req.keyword}%')`;
    const queryResult = await client.query(queryString);
    return queryResult;
}

app.post('/showBuildingInfo', async (req, res) => {
    try {
        const bgInfo = await getBuildingInfoAsync(req.body);
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

