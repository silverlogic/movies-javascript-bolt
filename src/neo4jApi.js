const neo4j = require('neo4j-driver')
const Movie = require('./models/Movie');
const MovieCast = require('./models/MovieCast');
const _ = require('lodash');

const neo4jUri = process.env.NEO4J_URI;
let neo4jVersion = process.env.NEO4J_VERSION;
if (neo4jVersion === '') {
  // assume Neo4j 4 by default
  neo4jVersion = '4';
}
let database = process.env.NEO4J_DATABASE;
if (!neo4jVersion.startsWith("4")) {
  database = null;
}
const driver = neo4j.driver(
    neo4jUri,
    neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD),
);

console.log(`Database '${database}' running at ${neo4jUri}`)

function searchMovies(queryString) {
  const session = driver.session({database: database});
  return session.readTransaction((tx) =>
      tx.run('MATCH (movie:Movie) \
      WHERE movie.title =~ $title \
      RETURN movie',
      {title: '(?i).*' + queryString + '.*'})
    )
    .then(result => {
      return result.records.map(record => {
        return new Movie(record.get('movie'));
      });
    })
    .catch(error => {
      throw error;
    })
    .finally(() => {
      return session.close();
    });
}

function getMovie(title) {
  const session = driver.session({database: database});
  return session.readTransaction((tx) =>
      tx.run("MATCH (movie:Movie {title:$title}) \
      OPTIONAL MATCH (movie)<-[r]-(person:Person) \
      RETURN movie.title AS title, \
      collect([person.name, \
           head(split(toLower(type(r)), '_')), r.roles]) AS cast \
      LIMIT 1", {title}))
    .then(result => {
      if (_.isEmpty(result.records))
        return null;

      const record = result.records[0];
      return new MovieCast(record.get('title'), record.get('cast'));
    })
    .catch(error => {
      throw error;
    })
    .finally(() => {
      return session.close();
    });
}

function voteInMovie(title) {
  const session = driver.session({ database: database });
  return session.writeTransaction((tx) =>
      tx.run("MATCH (m:Movie {title: $title}) \
        WITH m, (CASE WHEN exists(m.votes) THEN m.votes ELSE 0 END) AS currentVotes \
        SET m.votes = currentVotes + 1;", { title }))
    .then(result => {
      return result.summary.counters.updates().propertiesSet
    })
    .finally(() => {
      return session.close();
    });
}

function getGraph() {
  const session = driver.session({database: database});
  return session.readTransaction((tx) =>
    tx.run('MATCH (m:Movie)<-[:ACTED_IN]-(a:Person) \
    RETURN m.title AS movie, collect(a.name) AS cast \
    LIMIT $limit', {limit: neo4j.int(100)}))
    .then(results => {
      const nodes = [], rels = [];
      let i = 0;
      results.records.forEach(res => {
        nodes.push({title: res.get('movie'), label: 'movie'});
        const target = i;
        i++;

        res.get('cast').forEach(name => {
          const actor = {title: name, label: 'actor'};
          let source = _.findIndex(nodes, actor);
          if (source === -1) {
            nodes.push(actor);
            source = i;
            i++;
          }
          rels.push({source, target})
        })
      });

      return {nodes, links: rels};
    })
    .catch(error => {
      throw error;
    })
    .finally(() => {
      return session.close();
    });
}

exports.driver = driver;
exports.searchMovies = searchMovies;
exports.getMovie = getMovie;
exports.getGraph = getGraph;
exports.voteInMovie = voteInMovie;

