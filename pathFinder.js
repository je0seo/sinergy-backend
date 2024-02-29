const client = require('./config/db.js');
const { str2id } = require('./str2id.js');
const { createTempTable } = require('./tempTable.js');

const findPathAsync = async (requestData) => {
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
};

module.exports = {
    findPathAsync,
};
