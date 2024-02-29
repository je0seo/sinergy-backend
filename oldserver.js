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
async function findPathAsync(requestData) {
    try {
        const userReq1 = requestData;
        const userReqNum = await str2id(userReq1);
        var createTempTableQuery = `
  CREATE TEMP TABLE temp AS
  SELECT
    id, link_att, grad_deg, length, node1, node2, slopel,
    start_node.node_id as start_node_id, end_node.node_id as end_node_id,
    start_node.node_att as start_node_att, end_node.node_att as end_node_att,
    start_node.bol_width as start_bol_width, end_node.bol_width as end_bol_width,
    start_node.bump_hei as start_bump_hei, end_node.bump_hei as end_bump_hei
  FROM "link" AS link
  INNER JOIN "node" AS start_node ON "link".node1 = start_node.node_id
  INNER JOIN "node" AS end_node ON "link".node2 = end_node.node_id
`;
        if (userReq1.features.unpaved) {
            createTempTableQuery += ' WHERE link.link_att != 4'
            if (userReq1.features.stairs) {
                createTempTableQuery += ' AND link.link_att != 5'
                if (userReq1.features.slope) {
                    createTempTableQuery += ' AND link.grad_deg <= 3.18'
                    if (userReq1.features.bump) {
                        createTempTableQuery += ' AND start_node.bump_hei <= 2 AND end_node.bump_hei <= 2'
                        if (userReq1.features.bol) {
                            createTempTableQuery += ' AND start_node.node_att != 1 AND end_node.node_att != 1'
                        }
                    } else { //도로턱 제외 안 함
                        if (userReq1.features.bol) {
                            createTempTableQuery += ' AND start_node.node_att != 1 AND end_node.node_att != 1'
                        }
                    }
                } else {
                    if (userReq1.features.bump) {
                        createTempTableQuery += ' AND start_node.bump_hei <= 2 AND end_node.bump_hei <= 2'
                        if (userReq1.features.bol) {
                            createTempTableQuery += ' AND start_node.node_att != 1 AND end_node.node_att != 1'
                        }
                    } else {
                        if (userReq1.features.bol) {
                            createTempTableQuery += ' AND start_node.node_att != 1 AND end_node.node_att != 1'
                        }
                    }
                }
            } // stairs: false 일 때
            else {
                if (userReq1.features.slope) {
                    createTempTableQuery += ' AND link.grad_deg <= 3.18'
                    if (userReq1.features.bump) {
                        createTempTableQuery += ' AND start_node.bump_hei <= 2 AND end_node.bump_hei <= 2'
                        if (userReq1.features.bol) {
                            createTempTableQuery += ' AND start_node.node_att != 1 AND end_node.node_att != 1'
                        }
                    } else if (userReq1.features.bol) {
                        createTempTableQuery += ' AND start_node.node_att != 1 AND end_node.node_att != 1'
                    }
                } else {
                    if (userReq1.features.bump) {
                        createTempTableQuery += ' AND start_node.bump_hei <= 2 AND end_node.bump_hei <= 2'
                        if (userReq1.features.bol) {
                            createTempTableQuery += ' AND start_node.node_att != 1 AND end_node.node_att != 1'
                        }
                    } else if (userReq1.features.bol) {
                        createTempTableQuery += ' AND start_node.node_att != 1 AND end_node.node_att != 1'
                    }
                }
            }
        } else {
            if (userReq1.features.stairs) {
                createTempTableQuery += ' WHERE link.link_att != 5'
                if (userReq1.features.slope) {
                    createTempTableQuery += ' AND link.grad_deg <= 3.18'
                    if (userReq1.features.bump) {
                        createTempTableQuery += ' AND start_node.bump_hei <= 2 AND end_node.bump_hei <= 2'
                        if (userReq1.features.bol) {
                            createTempTableQuery += ' AND start_node.node_att != 1 AND end_node.node_att != 1'
                        }
                    } else { //도로턱 제외 안 함
                        if (userReq1.features.bol) {
                            createTempTableQuery += ' AND start_node.node_att != 1 AND end_node.node_att != 1'
                        }
                    }
                } else {
                    if (userReq1.features.bump) {
                        createTempTableQuery += ' AND start_node.bump_hei <= 2 AND end_node.bump_hei <= 2'
                        if (userReq1.features.bol) {
                            createTempTableQuery += ' AND start_node.node_att != 1 AND end_node.node_att != 1'
                        }
                    } else {
                        if (userReq1.features.bol) {
                            createTempTableQuery += ' AND start_node.node_att != 1 AND end_node.node_att != 1'
                        }
                    }
                }
            } // stairs: false 일 때
            else {
                if (userReq1.features.slope) {
                    createTempTableQuery += ' WHERE link.grad_deg <= 3.18'
                    if (userReq1.features.bump) {
                        createTempTableQuery += ' AND start_node.bump_hei <= 2 AND end_node.bump_hei <= 2'
                        if (userReq1.features.bol) {
                            createTempTableQuery += ' AND start_node.node_att != 1 AND end_node.node_att != 1'
                        }
                    } else if (userReq1.features.bol) {
                        createTempTableQuery += ' AND start_node.node_att != 1 AND end_node.node_att != 1'
                    }
                } else {
                    if (userReq1.features.bump) {
                        createTempTableQuery += ' WHERE start_node.bump_hei <= 2 AND end_node.bump_hei <= 2'
                        if (userReq1.features.bol) {
                            createTempTableQuery += ' AND start_node.node_att != 1 AND end_node.node_att != 1'
                        }
                    } else if (userReq1.features.bol) {
                        createTempTableQuery += ' WHERE start_node.node_att != 1 AND end_node.node_att != 1'
                    }
                }
            }
        }
        try {
            try{
                await client.query(createTempTableQuery);
            } catch (err)
            {
                await client.query('DROP TABLE temp');
                await client.query(createTempTableQuery);
            }
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
                        const queryresult = await client.query(`
                            SELECT pd.*, n.node_att, n.bol_width, n.bump_hei, l.link_att, l.grad_deg, n.node_geom, l.link_geom
                            FROM pgr_dijkstra(
                                         'SELECT id, node1 as source, node2 as target, slopel as cost FROM "temp" as edges',
                                         ${sourceNode}, ${targetNode}, false
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
            //console.log(sumAggCosts);
            const minAggCost = Math.min(...sumAggCosts);
            const minAggCostIndex = sumAggCosts.indexOf(minAggCost);
            let shortestPath = AllPaths[minAggCostIndex];
            console.log(shortestPath);
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
// 서버 시작
app.listen(serverPort, () => {
    console.log(`Server is running on port ${serverPort}`);
});
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something went wrong!');
});
