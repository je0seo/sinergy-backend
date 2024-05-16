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
        let str2idQuery = 'SELECT node_id from "node" WHERE  "node".bulid_name = $1 AND "node".node_att = 2';
        let str2idQuery1 = `SELECT n.node_id
                           FROM node as n
                           JOIN convenient as c
                           ON n.conv_cate = c.conv_cate
                           WHERE c.description = $1`;
        let str2idQuery2 = 'SELECT node_id from "node" WHERE  "node".nickname = $1 OR "node".eng_name = $1';
        let str2idQuery3 = 'SELECT node_id from "node" WHERE "node".lect_num = $1';
        let start = await executeQuery(userReq1.start, str2idQuery, str2idQuery1, str2idQuery2, str2idQuery3);
        let end = await executeQuery(userReq1.end, str2idQuery, str2idQuery1, str2idQuery2, str2idQuery3);
        const stopovers = userReq1.stopovers || [];
        let stopover = await Promise.all(stopovers.map(stop => executeQuery(stop, str2idQuery, str2idQuery1, str2idQuery2, str2idQuery3)));
        AllPoints = [start, ...stopover, end];
        console.log("AllPoints:", AllPoints);
        return AllPoints; //정문, 중도 -> AllPoints: [ [ 213, 215 ], [ 1227 ] ], 정문 - 중도 ->  [ [ 213, 215 ], [ 0 ], [ 1227 ] ], 정문, 자주터, 중도 ->  [ [ 213, 215 ], [ 1676, 1679 ], [ 1227 ] ]

    } catch (error) {
        console.error('str2id 함수 오류:', error);
    }
}

async function executeQuery(param, ...queries) {
    for (let query of queries) {
        const result = await client.query(query, [param]);
        const rows = result.rows.map(row => Number(row.node_id));
        if (rows.length > 0) {
            return rows;
        }
    }
    return [0];
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
        conditions.push(" WHEN (start_bol_width > 0 and start_bol_width < "+userReq.bolC+") or (end_bol_width > 0 and end_bol_width < "+userReq.bolC +") THEN 10000");
    }
    if (userReq.features.unpaved) { //비포장
        conditions.push(" WHEN link_att = 4 THEN 10000");
    }
    if (userReq.features.stairs) { //계단
        conditions.push(" WHEN link_att = 5 THEN 10000");
    }
    if (userReq.features.slope) { //경사
        conditions.push(" WHEN grad_deg >= "+userReq.slopeD+" AND link_att != 5 THEN 10000");
    }
    if (userReq.features.bump) { //도로턱
        conditions.push(" WHEN start_bump_hei >= "+userReq.bumpC+" or end_bump_hei >= "+userReq.bumpC +" THEN 10000");
    }
    if (userReq.obstacleIDs.ObstacleNodeIDs.length > 0) {
        conditions.push(" WHEN node1 in ("+ userReq.obstacleIDs.ObstacleNodeIDs +")" + " or node2 in ("+ userReq.obstacleIDs.ObstacleNodeIDs +") THEN 10000");
    }
    if (userReq.obstacleIDs.ObstacleLinkIDs.length > 0) {
        conditions.push(" WHEN id in ("+ userReq.obstacleIDs.ObstacleLinkIDs +") THEN 10000");
    }

    let caseCondition = conditions.length > 0
        ? `CASE ${conditions.join("")} ELSE slopel END as cost`
        : "slopel as cost";
    console.log(caseCondition);
    return caseCondition;
}


async function findPathAsync(requestData) {
    try {
        const userReq1 = requestData; //살려야하는 부분
        const userReqNum = await str2id(userReq1); // 입력지가 없으면 0
        console.log('userReqNum:', userReqNum);
        for (let index = 0; index <userReqNum.length; index++){
            if (userReqNum[index][0] === 0){
                if(index===0){
                    console.log("출발지 입력을 확인해주세요.");
                    return {StartEndNormalCheckMessage : "출발지 입력을 확인해주세요." };
                }
                else if(index === userReqNum.length -1){
                    console.log("도착지 입력을 확인해주세요.");
                    return {StartEndNormalCheckMessage : "도착지 입력을 확인해주세요."};
                }
                else {
                    console.log("경유지 입력을 확인해주세요.");
                    return {StartEndNormalCheckMessage : "경유지 입력을 확인해주세요."};
                }
            }
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
                                        JOIN node as n ON pd.node = n.node_id
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

const ConvCateId = {
    'bench': 0,     //벤치
    'smoking': 1,   //흡연 부스
    'store': 2,     //편의점
    'bicycle': 3,   //자전거거치대
    'cafe': 4,      // 카페
    'atm': 5,       //은행/atm
    'postoffice': 6,     //우체국
    'healthservice': 7, //보건소
    'cafeteria': 8,     //학생식당
    'print': 9,         //복사실
    'gym': 10,          //헬스장
    'tennis': 11,       //테니스장
    'basketball': 12,   //농구장
    'breakroom': 13,    //휴게실
    'lounge': 14,       //학생라운지
    'seminarroom': 15,  //세미나실
    'Sbicycle': 16,     //따릉이대여소
    'library': '17, 24',      //도서관
    'vendingMachine': 18,    //자판기
    'toilet': 19, //장애인 화장실
    'unmanned civil service': 20, //무인민원발급기
    'rooftop garden': 21, //옥상정원
    'shower room': 22, //샤워실
    'foot volley': 23, // 족구장
    'book store': 24, // 서점/문구점
    'restaurant': 25,// 식당
    'squash': 26, // 스쿼시
    'parking': 27, //주차장
    'sports': '10, 23, 11, 12',
    'dining': '8, 25',
    'cafe&store': '2, 4',
}

const LinkAtt = {
    'unpaved': 4,
    'stairs': 5
}

Object.freeze(ConvCateId);
Object.freeze(LinkAtt);

function getConvCateId(type) {
    return ConvCateId[type]
}
function getLinkAtt(type) {
    return LinkAtt[type]
}

function createQueryBy(Req) { //{ReqType, slopeD, bolC, bumpC}
    const query4Conv = `SELECT c.node_id, c.image_url, c.summary ,c.location
                     FROM conv_info as c
                     INNER JOIN node as n
                     ON c.node_id = n.node_id`
    const query4LinkObs = `SELECT id, image_lobs, grad_deg FROM link`

    switch (Req.ReqType) {
        case 'facilities':
            return query4Conv + ` WHERE n.node_att = 8`;
        case 'unpaved':
        case 'stairs':
            return query4LinkObs + ` WHERE link_att in (${getLinkAtt(Req.ReqType)})`;
        case 'slope':
            return query4LinkObs + ` WHERE link_att != 5 AND grad_deg >= `+Req.slopeD;
        case 'bump':
            return 'SELECT node_id, image_nobs, bump_hei FROM "node" WHERE bump_hei >= '+Req.bumpC;
        case 'bol':
            return 'SELECT node_id, image_nobs, bol_width FROM "node" WHERE bol_width > 0 and bol_width < '+Req.bolC;
        default:
            return query4Conv + ` WHERE n.conv_cate in (${getConvCateId(Req.ReqType)})`;
    }
}


async function ShowReqAsync(requestDatatype) {
    try {
        // {ReqType, slopeD, bolC, bumpC}
        const Id4ShowQuery = createQueryBy(requestDatatype.Req);
        console.log(Id4ShowQuery);
        const queryResults = await client.query(Id4ShowQuery);
        const A = queryResults.rows;

        let ids;
        let images;
        let info;
        let location;
        switch (requestDatatype.Req.ReqType) {
            case 'bump':
            case 'bol':
                ids = A.map(item => Number(item.node_id));
                images = A.map(item => item.image_nobs);
                info = (requestDatatype.Req.ReqType === 'bump') ? A.map(item => item.bump_hei) : A.map(item => item.bol_width);
                break;
            case 'unpaved':
            case 'stairs':
            case 'slope':
                ids = A.map(item => Number(item.id));
                images = A.map(item => item.image_lobs);
                info = A.map(item => item.grad_deg);
                break;
            default:
                ids = A.map(item => Number(item.node_id));
                images = A.map(item => item.image_url);
                info = A.map(item => item.summary)
                location = A.map(item => item.location)
        }
        if (location)
            return {ids, images, info, location}
        else
            return {ids, images, info}
    } catch (error) {
        console.error('Error in ShowReqAsync:', error);
        throw error; // 높은 catch 블록에서 잡힐 오류를 다시 던집니다.
    }
}
app.post('/ShowReq', async (req, res) => {
    try {
        const data = await ShowReqAsync(req.body);
        if (data.location)
            res.json({ ids: data.ids, images: data.images, info: data.info, location: data.location}) // 클라이언트에게 편의시설/장애물종류별 ID, 이미지, 추가정보 배열 전송
        else
            res.json({ ids: data.ids, images: data.images, info: data.info});
    } catch (error) {
        console.error('Error during POST request:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

function createQueryConditions(req) {
    const commonString = `SELECT b.bd_id, p.bg_name, p.type, b.summary, b.image_url,
                            b.total_floor, b.lounge_count, p.eng_name, p.nickname
                             FROM bd_info as b
                             INNER JOIN poi_point as p
                             ON b.bg_name = p.bg_name`;
    // 입력된 검색어(예: '학')가 bg_name 또는 nickname 항목에 속할 경우, 검색어의 인덱스 순으로 (예: 학생회관>대학본부>과학기술관) ㄱㄴㄷ순 정렬
    const c_kor = ` WHERE p.bg_name LIKE '%${req.keyword}%'
                    OR p.nickname LIKE '%${req.keyword}%'
                    ORDER BY POSITION('${req.keyword}' IN p.bg_name) ASC,
                    p.bg_name COLLATE "ko_KR.utf8" ASC`;
    // 입력된 검색어가 eng_name 항목에 속할 경우 ABC순 정렬
    const c_eng = ` WHERE p.eng_name ILIKE '%${req.keyword}%'
                    ORDER BY eng_name ASC`;
    return [commonString+c_kor, commonString+c_eng];
}

async function getBuildingInfoAsync(conditions) {
    for (let i=0;i<conditions.length;i++) {
        const queryResult = await client.query(conditions[i]);
        if (queryResult.rowCount > 0) {  // 검색 결과가 있으면 바로 함수 종료
            console.log(queryResult.rows);
            return queryResult;
        }
        if (i === conditions.length-1)   // 세 개의 검색 조건 다 결과가 없을 경우 맨 마지막 쿼리 결과 return
            return queryResult;
    }
}

app.post('/showBuildingInfo', async (req, res) => {
    try {
        let conditions = createQueryConditions(req.body)
        const bgInfo = await getBuildingInfoAsync(conditions);
        res.json(bgInfo);
    } catch (error) {
        console.error('Error during POST request:', error);
        res.status(500).json({error: 'Internal Server Error'});
    }
});

async function getBuildingInfoAsync(conditions) {
    for (let i=0;i<conditions.length;i++) {
        const queryResult = await client.query(conditions[i]);
        if (queryResult.rowCount > 0) {  // 검색 결과가 있으면 바로 함수 종료
            console.log(queryResult.rows);
            return queryResult;
        }
        if (i === conditions.length-1)   // 세 개의 검색 조건 다 결과가 없을 경우 맨 마지막 쿼리 결과 return
            return queryResult;
    }
}

async function showYourPosition(locaArray) {
    locaArray = locaArray.join(','); // locaArray를 쉼표로 구분된 문자열로 변환
    query = `SELECT bulid_name, floor FROM node
            WHERE floor IS NOT null AND node_id in (${locaArray})`
    position = await client.query(query)

    return position.rows
}

app.post('/showYourPosition', async (req, res) => {
    try {
        const indoorPositions = await showYourPosition(req.body);
        console.log(indoorPositions)
        res.json(indoorPositions);
    } catch (error) {
        console.error('Error in showYourPosition:', error);
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

